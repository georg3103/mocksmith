import log from 'loglevel';

import { logFoundMock, logNotFoundMock } from '../utils/utils';

import {
  Handler,
  HandlerOptions,
  MockFunction,
  MocksAPI,
  MocksRequestPayload,
  MocksResultData,
} from '../types';

export const mockHandler = async <Data extends MocksResultData = MocksResultData>(
  options: HandlerOptions<Data>
): Promise<ReturnType<Handler<Data>>> => {
  try {
    const { context, name, request, data: requestData, sendToWebSocket } = options;

    let mock = context.getHandler(name);

    if (!mock) {
      logNotFoundMock(name);

      return;
    }

    const handler = mock.handler;

    if (typeof handler === 'function') {
      requestData.urlParams = mock.params;

      // @ts-expect-error handler union is too wide here
      const { extraParams, ...mockApiData } = context.getApiData();

      let currentExtraParams;

      if (extraParams) {
        currentExtraParams = typeof extraParams === 'object' ? extraParams[name] : extraParams;
      }

      const handlerFn = handler as MockFunction<MocksAPI, MocksRequestPayload, Data>;

      const res = handlerFn(
        { ...mockApiData, extraParams: currentExtraParams },
        {
          context,
          request,
          name,
          requestData,
        },
        sendToWebSocket
      );

      if (res) {
        logFoundMock(name);

        return res;
      } else {
        return;
      }
    } else {
      return handler;
    }
  } catch (error: unknown) {
    log.error(error);
  }
};
