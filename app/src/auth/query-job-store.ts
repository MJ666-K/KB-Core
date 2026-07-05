import { nanoid } from 'nanoid';
import { getRedis } from '../redis/client';
import { config } from '../config';

export type QueryJobStatus = 'running' | 'completed' | 'failed';

export interface QueryJobRecord {
  id: string;
  userId: string;
  sessionId: string;
  question: string;
  status: QueryJobStatus;
  events: Array<Record<string, unknown>>;
  partialAnswer: string;
  result: Record<string, unknown> | null;
  error: string | null;
  updatedAt: number;
}

const JOB_PREFIX = 'query:job:';
const SESSION_JOB_PREFIX = 'query:session:';
const MAX_EVENTS = 400;

function jobKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}`;
}

function sessionJobKey(sessionId: string): string {
  return `${SESSION_JOB_PREFIX}${sessionId}`;
}

export async function createQueryJob(input: {
  userId: string;
  sessionId: string;
  question: string;
}): Promise<string> {
  const redis = getRedis();
  const jobId = nanoid(16);
  const record: QueryJobRecord = {
    id: jobId,
    userId: input.userId,
    sessionId: input.sessionId,
    question: input.question,
    status: 'running',
    events: [],
    partialAnswer: '',
    result: null,
    error: null,
    updatedAt: Date.now(),
  };
  await redis.set(jobKey(jobId), JSON.stringify(record), 'EX', config.queryJobTtlSec);
  await redis.set(sessionJobKey(input.sessionId), jobId, 'EX', config.queryJobTtlSec);
  return jobId;
}

export async function getQueryJob(jobId: string): Promise<QueryJobRecord | null> {
  const raw = await getRedis().get(jobKey(jobId));
  if (!raw) return null;
  return JSON.parse(raw) as QueryJobRecord;
}

export async function getActiveJobForSession(sessionId: string): Promise<QueryJobRecord | null> {
  const jobId = await getRedis().get(sessionJobKey(sessionId));
  if (!jobId) return null;
  return getQueryJob(jobId);
}

export async function appendQueryJobEvent(jobId: string, event: Record<string, unknown>): Promise<void> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) return;
  const record = JSON.parse(raw) as QueryJobRecord;
  record.events.push(event);
  if (record.events.length > MAX_EVENTS) {
    record.events = record.events.slice(-MAX_EVENTS);
  }
  if (event.type === 'token' && typeof event.token === 'string') {
    record.partialAnswer += event.token;
  }
  record.updatedAt = Date.now();
  await redis.set(jobKey(jobId), JSON.stringify(record), 'EX', config.queryJobTtlSec);
}

export async function completeQueryJob(
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) return;
  const record = JSON.parse(raw) as QueryJobRecord;
  record.status = 'completed';
  record.result = result;
  record.partialAnswer = typeof result.answer === 'string' ? result.answer : record.partialAnswer;
  record.updatedAt = Date.now();
  await redis.set(jobKey(jobId), JSON.stringify(record), 'EX', config.queryJobTtlSec);
}

export async function failQueryJob(jobId: string, error: string): Promise<void> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) return;
  const record = JSON.parse(raw) as QueryJobRecord;
  record.status = 'failed';
  record.error = error;
  record.updatedAt = Date.now();
  await redis.set(jobKey(jobId), JSON.stringify(record), 'EX', config.queryJobTtlSec);
}

export async function clearSessionActiveJob(sessionId: string): Promise<void> {
  await getRedis().del(sessionJobKey(sessionId));
}
