const fs = require("fs");
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

function createS3Client(region) {
  return new S3Client({ region });
}

async function uploadFile({
  s3,
  bucket,
  key,
  filePath,
  storageClass,
  contentType,
  metadata,
  logger
}) {
  logger?.info("s3_upload_start", { bucket, key, storageClass, filePath });
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      StorageClass: storageClass,
      ContentType: contentType,
      Metadata: metadata
    }
  });
  await upload.done();
  logger?.info("s3_upload_done", { bucket, key });
}

async function putJson({ s3, bucket, key, body, storageClass, logger }) {
  logger?.info("s3_put_json", { bucket, key });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(body, null, 2),
      ContentType: "application/json",
      StorageClass: storageClass
    })
  );
}

async function downloadToFile({ s3, bucket, key, filePath, logger }) {
  logger?.info("s3_download_start", { bucket, key, filePath });
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const write = fs.createWriteStream(filePath);
    res.Body.on("error", reject);
    write.on("error", reject);
    write.on("close", resolve);
    res.Body.pipe(write);
  });
  logger?.info("s3_download_done", { bucket, key, filePath });
}

async function headObject({ s3, bucket, key }) {
  return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

async function findLatestArchive({ s3, bucket, prefix }) {
  let continuationToken;
  let latest = null;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    for (const obj of res.Contents || []) {
      if (!obj.Key.endsWith(".archive.gz")) continue;
      if (!latest || new Date(obj.LastModified) > new Date(latest.LastModified)) {
        latest = obj;
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return latest;
}

module.exports = {
  createS3Client,
  uploadFile,
  putJson,
  downloadToFile,
  headObject,
  findLatestArchive
};
