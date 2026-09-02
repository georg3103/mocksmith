import type { MockData, MockFunction, MockHandlers, MocksAPI } from 'mocksmith';

export type Todo = { id: number; title: string; done: boolean };

export type TodoApi = MocksAPI & {
  user: { name: string; plan: 'free' | 'pro' };
  todos: Todo[];
};

const json = (body: unknown, status = 200): MockData => ({
  response: {
    status,
    headers: { 'content-type': 'application/json' },
    body: body as MockData['response']['body'],
  },
});

/**
 * Handlers are keyed by path, not by method — the method is read from the
 * request itself. `request` is absent only when a plugin calls a handler
 * in-process, which never happens here.
 * */
const methodOf = (request?: { method?: string }) => request?.method?.toUpperCase() ?? 'GET';

/**
 * `api` is a shallow copy made per request, so writes go through the session
 * itself: `context.getApiData()` is the live object the whole session reads.
 * */
const stateOf = (context: { getApiData: () => unknown }) => context.getApiData() as TodoApi;

const nextId = (todos: Todo[]) => todos.reduce((max, todo) => Math.max(max, todo.id), 0) + 1;

/** GET /api/board — everything the page needs for a first paint. */
const getBoard: MockFunction<TodoApi> = (api) =>
  json({ user: api.user, todos: api.todos });

/**
 * GET /api/todos — the list.
 * POST /api/todos — adds one, then pushes the new list into this session's
 * websockets so any other open tab updates without polling.
 * */
const todos: MockFunction<TodoApi> = (api, { context, request, requestData }, sendToWebSocket) => {
  const state = stateOf(context);

  if (methodOf(request) === 'POST') {
    const title = String((requestData.body as { title?: unknown })?.title ?? '').trim();

    if (!title) {
      return json({ error: 'title is required' }, 422);
    }

    const todo: Todo = { id: nextId(state.todos), title, done: false };

    state.todos.push(todo);
    sendToWebSocket({ type: 'todos', todos: state.todos });

    return json({ todo, todos: state.todos }, 201);
  }

  return json({ todos: api.todos });
};

/**
 * PATCH /api/todos/:id — toggles or renames.
 * DELETE /api/todos/:id — removes.
 * The `:id` segment arrives in `requestData.urlParams`.
 * */
const todoById: MockFunction<TodoApi> = (_api, { context, request, requestData }, sendToWebSocket) => {
  const state = stateOf(context);
  const id = Number((requestData.urlParams as { id?: string })?.id);
  const index = state.todos.findIndex((todo) => todo.id === id);

  if (index === -1) {
    return json({ error: `no todo with id ${id}` }, 404);
  }

  if (methodOf(request) === 'DELETE') {
    const [removed] = state.todos.splice(index, 1);

    sendToWebSocket({ type: 'todos', todos: state.todos });

    return json({ removed, todos: state.todos });
  }

  const patch = requestData.body as Partial<Todo> | undefined;
  const todo = state.todos[index];

  if (typeof patch?.done === 'boolean') {
    todo.done = patch.done;
  }

  if (typeof patch?.title === 'string' && patch.title.trim()) {
    todo.title = patch.title.trim();
  }

  sendToWebSocket({ type: 'todos', todos: state.todos });

  return json({ todo, todos: state.todos });
};

export default {
  '/api/board': getBoard,
  '/api/todos': todos,
  '/api/todos/:id': todoById,
} satisfies MockHandlers<TodoApi>;
