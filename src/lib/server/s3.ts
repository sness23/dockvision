import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

export const s3 = new S3Client({
	region: env.AWS_REGION || 'us-east-1',
	// S3_ENDPOINT lets us point at MinIO locally (or any S3-compatible service).
	// forcePathStyle is required for MinIO; harmless for real AWS S3 when no endpoint set.
	endpoint: env.S3_ENDPOINT || undefined,
	forcePathStyle: !!env.S3_ENDPOINT,
	credentials:
		env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY
				}
			: undefined
});

export const BUCKET = env.S3_BUCKET || 'dockvision-prod';

export function presignedGet(key: string, ttlSec = 3600): Promise<string> {
	return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
		expiresIn: ttlSec
	});
}

export function presignedPut(key: string, contentType: string, ttlSec = 3600): Promise<string> {
	return getSignedUrl(
		s3,
		new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
		{ expiresIn: ttlSec }
	);
}

export async function deleteObject(key: string): Promise<void> {
	await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
	await s3.send(
		new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
	);
}
