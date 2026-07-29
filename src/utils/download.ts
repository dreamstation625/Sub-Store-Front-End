const getFilename = (disposition: string | null, fallback: string) => {
  const encoded = disposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
  if (!encoded) return fallback;

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

type BlobResponse = {
  data: Blob;
  status: number;
  headers?: Record<string, string | undefined>;
};

export const downloadBlobResponse = (
  response: BlobResponse | undefined,
  fallbackFilename: string,
) => {
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response?.status || 0}`);
  }

  const objectUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = getFilename(
    response.headers?.['content-disposition'] || null,
    fallbackFilename,
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
