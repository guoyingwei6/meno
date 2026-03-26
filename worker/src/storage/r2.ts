export const storeUpload = async (
  bucket: R2Bucket,
  input: {
    objectKey: string;
    file: File;
  },
) => {
  await bucket.put(input.objectKey, await input.file.arrayBuffer(), {
    httpMetadata: {
      contentType: input.file.type || 'application/octet-stream',
    },
  });
};
