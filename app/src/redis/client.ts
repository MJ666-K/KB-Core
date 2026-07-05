import Redis from 'ioredis';
import { config } from '../config';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (redis.status === 'ready') return;
  await redis.connect();
}
