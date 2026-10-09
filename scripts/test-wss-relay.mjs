import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../src/utils/wssRelay.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, require };
vm.createContext(context);
vm.runInContext(code, context);
const { createWssRelaySession, getWssRelayClientColumns, normalizeRelayNodeId, getConfiguredRelayNodeId } = context.exports;
const success = (data) => ({ data: { status: 'success', data } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function fixture() {
  const state = { token: '', initialized: null, loading: false, creating: false, clients: [] };
  let backend = 'https://backend-a.test';
  const calls = [];
  const api = {
    getSettings: async (url) => { calls.push(['settings', url]); return success({ wssRelayToken: 'token-a' }); },
    getWssRelayClients: async (token, url) => { calls.push(['clients', token, url]); return success([{ id: 'node-a' }]); },
    createWssRelayToken: async (token, rotate, url) => { calls.push(['initialize', token, rotate, url]); return success({ token: 'created-token' }); },
  };
  const session = createWssRelaySession(state, api, () => backend);
  return { state, api, calls, session, switchTo: (url) => { backend = url; session.reset(); } };
}

test('新浏览器直接从后端读取 Token 和节点，不需要本地缓存', async () => {
  const { state, session, calls } = fixture();
  assert.equal(await session.refresh(true), true);
  assert.equal(state.token, 'token-a');
  assert.equal(state.clients[0].id, 'node-a');
  assert.deepEqual(calls, [['settings', 'https://backend-a.test'], ['clients', 'token-a', 'https://backend-a.test']]);
});

for (const [name, response, initialized] of [
  ['没有 Token 字段', {}, false], ['空 Token', { wssRelayToken: '' }, false],
  ['旧后端遮蔽 Token', { wssRelayToken: '***' }, true],
]) {
  test(`${name}不保留其他后端的 Token 或节点`, async () => {
    const { state, session, api, calls } = fixture();
    await session.refresh(true);
    api.getSettings = async () => success(response);
    await session.refresh(true);
    assert.equal(state.token, '');
    assert.equal(state.clients.length, 0);
    assert.equal(state.initialized, initialized);
    assert.equal(calls.filter(([type]) => type === 'clients').length, 1);
  });
}

for (const reject of [true, false]) {
  test(`后端${reject ? '请求抛错' : '返回失败'}清空旧回显`, async () => {
    const { state, session, api } = fixture();
    await session.refresh(true);
    api.getSettings = async () => { if (reject) throw Error('offline'); return { data: { status: 'failed' } }; };
    assert.equal(await session.refresh(true), false);
    assert.equal(state.token, '');
    assert.equal(state.initialized, null);
    assert.equal(state.clients.length, 0);
    assert.equal(state.loading, false);
  });
}

test('旧设置响应不能覆盖切换后的后端', async () => {
  const { state, session, api, switchTo } = fixture();
  const old = deferred();
  api.getSettings = () => old.promise;
  const oldRequest = session.refresh(true);
  switchTo('https://backend-b.test');
  api.getSettings = async () => success({ wssRelayToken: 'token-b' });
  await session.refresh(true);
  old.resolve(success({ wssRelayToken: 'token-a' }));
  assert.equal(await oldRequest, false);
  assert.equal(state.token, 'token-b');
});

test('旧节点列表响应不能覆盖新后端，包括切回原地址', async () => {
  const { state, session, api, switchTo } = fixture();
  const old = deferred();
  api.getWssRelayClients = () => old.promise;
  const oldRequest = session.refresh(true);
  await Promise.resolve();
  switchTo('https://backend-b.test');
  switchTo('https://backend-a.test');
  api.getWssRelayClients = async () => success([{ id: 'new-node' }]);
  await session.refresh(true);
  old.resolve(success([{ id: 'old-node' }]));
  assert.equal(await oldRequest, false);
  assert.equal(state.clients[0].id, 'new-node');
});

test('Token 初始化锁定后端，切换后旧响应不能回写', async () => {
  const { state, session, api, switchTo, calls } = fixture();
  await session.refresh();
  await session.initialize();
  assert.equal(state.token, 'created-token');
  assert.deepEqual(calls.at(-1), ['initialize', 'token-a', false, 'https://backend-a.test']);
  const old = deferred();
  api.createWssRelayToken = () => old.promise;
  const pending = session.initialize();
  switchTo('https://backend-b.test');
  old.resolve(success({ token: 'wrong-backend-token' }));
  assert.equal(await pending, false);
  assert.equal(state.token, '');
  assert.equal(state.creating, false);
});

test('离线节点仍在选项中，NutUI 确认不能默认回到本机', () => {
  const columns = getWssRelayClientColumns([{ id: 'online', name: '在线节点' }], 'saved-offline');
  assert.equal(columns.filter((item) => item.value === 'saved-offline').length, 1);
  assert.match(columns.find((item) => item.value === 'saved-offline').text, /离线/);
  // 运行当前实际依赖的 picker-column 初始化及确认逻辑。
  const pickerPath = require.resolve('@nutui/nutui').replace(/[^\\/]+$/, 'packages/_es/Picker.js');
  const picker = fs.readFileSync(pickerPath, 'utf8');
  const setup = picker.slice(0, picker.indexOf('const _hoisted_1$1')).replace(/^import .*;\r?\n/gm, '');
  const vue = require('vue');
  const mounted = [], events = [];
  const pickerContext = {
    ...vue, onMounted: (fn) => mounted.push(fn), useTouch: () => ({}),
    createComponent: () => ({ create: (value) => value }),
    preventDefault: () => {}, clamp: (value, min, max) => Math.min(Math.max(value, min), max),
  };
  vm.createContext(pickerContext);
  vm.runInContext(`${setup}\nglobalThis.definition = _sfc_main$1;`, pickerContext);
  const instance = pickerContext.definition.setup(vue.reactive({ value: 'saved-offline', column: columns, threeDimensional: true }), {
    emit: (_, option) => events.push(option.value),
  });
  mounted.forEach((fn) => fn());
  instance.stopMomentum();
  assert.equal(events.at(-1), 'saved-offline');
  assert.equal(getWssRelayClientColumns([{ id: 'online' }], 'online').length, 2);
});

test('本机或本地来源明确提交空节点，远端 ID 去除空格', () => {
  const local = { relayNodeId: 'old' };
  normalizeRelayNodeId(local, false);
  assert.equal(local.relayNodeId, '');
  const remote = { relayNodeId: '  node  ' };
  normalizeRelayNodeId(remote, true);
  assert.equal(remote.relayNodeId, 'node');
  const empty = {};
  normalizeRelayNodeId(empty, true);
  assert.equal(empty.relayNodeId, '');
  for (const file of ['FileEditor.vue', 'SubEditor.vue']) {
    const editor = fs.readFileSync(new URL(`../src/views/${file}`, import.meta.url), 'utf8');
    assert.match(editor, /useWssRelay\(true\)/);
    assert.doesNotMatch(editor, /if \(!data\.relayNodeId\) delete data\.relayNodeId/);
    assert.match(editor, /normalizeRelay(?:NodeId|Selection)\(data,/);
  }
});

test('卡片角标仅使用远端来源中保存的节点，忽略本地残留和空节点', () => {
  assert.equal(getConfiguredRelayNodeId({ relayNodeId: '  nb-1  ' }, 'remote'), 'nb-1');
  for (const mode of ['local', 'subscription', 'collection', undefined]) {
    assert.equal(getConfiguredRelayNodeId({ relayNodeId: 'stale-node' }, mode), '');
  }
  for (const data of [undefined, {}, { relayNodeId: '' }, { relayNodeId: '   ' }, { relayNodeId: true }]) {
    assert.equal(getConfiguredRelayNodeId(data, 'remote'), '');
  }
});

test('真实卡片的角标计算：订阅、文件及两种 Mihomo 类型按实际来源判断并响应修改', () => {
  const vue = require('vue');
  const fileTypeContext = { exports: {} };
  vm.createContext(fileTypeContext);
  vm.runInContext(ts.transpileModule(
    fs.readFileSync(new URL('../src/utils/fileType.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText, fileTypeContext);
  for (const name of ['SubListItem.vue', 'FileListItem.vue']) {
    const card = fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');
    const calculation = card.match(/const relayNodeId = computed\(\(\) =>[\s\S]*?: ''\);/)?.[0];
    assert.ok(calculation, `${name} 提供响应式节点判断`);
    const props = vue.reactive({ type: 'sub', sub: { source: 'remote', relayNodeId: 'nb-1' }, file: {} });
    const cardContext = {
      props, computed: vue.computed, getConfiguredRelayNodeId,
      isMihomoConfigFileType: fileTypeContext.exports.isMihomoConfigFileType,
    };
    vm.createContext(cardContext);
    vm.runInContext(`${calculation}\nglobalThis.node = relayNodeId;`, cardContext);
    const node = cardContext.node;
    if (name === 'SubListItem.vue') {
      assert.equal(node.value, 'nb-1');
      props.sub.relayNodeId = '';
      assert.equal(node.value, '');
      props.sub = { source: 'local', relayNodeId: 'stale' };
      assert.equal(node.value, '');
      props.type = 'collection';
      assert.equal(node.value, '');
    } else {
      assert.equal(node.value, '');
      props.type = 'file';
      props.file = { type: 'file', source: 'remote', relayNodeId: 'nb-file' };
      assert.equal(node.value, 'nb-file');
      for (const type of ['mihomoConfig', 'mihomoProfile']) {
        props.file = { type, source: 'local', sourceType: 'remote', relayNodeId: 'nb-config' };
        assert.equal(node.value, 'nb-config');
        for (const sourceType of ['local', 'subscription', 'collection']) {
          props.file.sourceType = sourceType;
          assert.equal(node.value, '');
        }
      }
    }
  }
});

test('角标实际组件渲染：小标签、节点提示、安全转义和本机隐藏', async () => {
  const { parse, compileScript } = require('vue/compiler-sfc');
  const vue = require('vue');
  const { renderToString } = require('vue/server-renderer');
  const badge = fs.readFileSync(new URL('../src/components/WssRelayBadge.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(badge);
  const compiled = compileScript(descriptor, { id: 'wss-relay-badge', inlineTemplate: true });
  const compiledCode = ts.transpileModule(compiled.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const badgeContext = { exports: {}, require };
  vm.createContext(badgeContext);
  vm.runInContext(compiledCode, badgeContext);
  const component = badgeContext.exports.default;
  const remote = await renderToString(vue.createSSRApp(component, { nodeId: 'node-<test>' }));
  assert.match(remote, /远端 WS/);
  assert.match(remote, /不代表在线状态/);
  assert.match(remote, /node-&lt;test&gt;/);
  assert.doesNotMatch(remote, /<test>/);
  const local = await renderToString(vue.createSSRApp(component, { nodeId: '' }));
  assert.doesNotMatch(local, /wss-relay-badge/);
  assert.match(descriptor.styles[0].content, /font-size: 9px/);
  for (const name of ['SubListItem.vue', 'FileListItem.vue']) {
    const card = fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');
    assert.match(card, /<WssRelayBadge :node-id="relayNodeId"/);
    assert.match(card, /paddingTop: relayNodeId/);
    assert.match(card, /getConfiguredRelayNodeId/);
  }
});
