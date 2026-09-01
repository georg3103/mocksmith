import type { MockHandlers, MocksAPI, RewritePath, SseHandler } from '../types';
import type { WebsocketMessageEncoder } from '../websocketEncoder';
import type {
  ConfigResourceValidator,
  MockerRawSocketHandler,
  MockerWebsocketHandler,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const hasHandlerAndPath = (value: unknown) => {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    Boolean(value.path.trim()) &&
    typeof value.handler === 'function'
  );
};

const validators = {
  defaultSessionData: isRecord as ConfigResourceValidator<object>,
  handlers: isRecord as ConfigResourceValidator<MockHandlers<MocksAPI>>,
  rewritePath: ((value: unknown): value is RewritePath =>
    typeof value === 'function') as ConfigResourceValidator<RewritePath>,
  rawSocketHandler: ((value: unknown): value is MockerRawSocketHandler =>
    typeof value === 'function') as ConfigResourceValidator<MockerRawSocketHandler>,
  sseHandlers: ((value: unknown): value is SseHandler[] => {
    return Array.isArray(value) && value.every(hasHandlerAndPath);
  }) as ConfigResourceValidator<SseHandler[]>,
  websocketHandlers: ((value: unknown): value is MockerWebsocketHandler[] => {
    return Array.isArray(value) && value.every(hasHandlerAndPath);
  }) as ConfigResourceValidator<MockerWebsocketHandler[]>,
  websocketEncoder: ((value: unknown): value is WebsocketMessageEncoder =>
    typeof value === 'function') as ConfigResourceValidator<WebsocketMessageEncoder>,
};

export const configResourceValidation = {
  isRecord,
  validate: <T>(value: unknown, field: string, validator: ConfigResourceValidator<T>): T => {
    if (!validator(value)) {
      throw new Error(`${field} has an invalid structure`);
    }

    return value;
  },
  validators,
};
