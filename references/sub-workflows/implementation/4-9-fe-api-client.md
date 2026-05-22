---
title: "Phase 4.9 — API Client & State Management Layer"
description: >
  Generate TypeScript types from the OpenAPI specification, build a typed API client
  with auth token handling and error interceptors, set up the server-state management
  layer (TanStack Query / SWR / RTK Query), and create a mock server for offline
  development and testing.
sub_workflow: "4-9-fe-api-client"
phase: 4
sub_phase: "4.9"
version: "3.6.0"
inputs:
  - api-spec.yaml
outputs:
  - api-client-report.md
dependencies:
  upstream: [phase_4_7]
  downstream: [phase_4_10]
---

# Phase 4.9 — API Client & State Management Layer

## FSM State Transition Table

| Current State    | Valid Transition    | Trigger / Condition                                     | Next State      |
|:-----------------|:--------------------|:--------------------------------------------------------|:----------------|
| NOT_STARTED      | START               | Gate Card passes; phase execution begins                | IN_PROGRESS     |
| IN_PROGRESS      | CLIENT_READY        | API client + types + auth flow built                    | CLIENT_GENERATED|
| CLIENT_GENERATED | MOCKS_READY         | Mock server set up with handlers for all endpoints      | MOCKS_READY     |
| MOCKS_READY      | VERIFY              | All functions compile, mock server responds, auth cycle works | VERIFIED    |
| VERIFIED         | LOCK                | API client report generated and reviewed                | LOCKED          |
| NOT_STARTED      | (none)              | —                                                       | —               |
| IN_PROGRESS      | FAIL                | Critical generation error                               | NOT_STARTED     |
| CLIENT_GENERATED | REGENERATE          | API spec changed, re-generation needed                  | IN_PROGRESS     |
| MOCKS_READY      | REMOCK              | Mock data does not match updated spec                   | CLIENT_GENERATED|
| VERIFIED         | UNLOCK              | Upstream api-spec.yaml changed                          | MOCKS_READY     |

**Final State:** `LOCKED`
**State persistence:** `sprint-status.yaml` key `phase_4_9`

---

## Gate Card

```yaml
gate_card:
  phase: 4.9
  gates:
    - check: sprint_status.phase_4_7
      operator: equals
      expected: "LOCKED"
      fail_action: "HALT — Phase 4.7 (Frontend Scaffolding) must be LOCKED before building the API client layer"
  gate_pass_action: "Set phase_4_9 status to IN_PROGRESS in sprint-status.yaml"
```

---

## Step-by-Step Instructions

### Step 1 — Gate Card Check

Read `{sprint_tracking}/sprint-status.yaml`. Verify:

```yaml
phase_4_7: LOCKED
```

If the check fails, **HALT** and report: "Phase 4.7 is not yet LOCKED. Frontend scaffolding must be complete before building the API client."

If the gate passes, update `sprint-status.yaml`:

```yaml
phase_4_9: IN_PROGRESS
```

---

### Step 2 — Load API Spec

Read `{api_spec_output}/api-spec.yaml` in full. Extract:

- **All endpoints**: method + path + operationId
- **All schemas**: request bodies, response bodies, query parameters, path parameters
- **Auth requirements**: which endpoints require authentication, token format
- **Base URL**: server URLs defined in the spec
- **Error response format**: standard error schema
- **Pagination pattern**: offset-based, cursor-based, or page-based

---

### Step 3 — Type Generation

Generate TypeScript types from the OpenAPI schemas. Choose one approach:

**Option A: Manual type definition** (small APIs, < 20 endpoints)

```typescript
// src/types/api.ts
// Generated from api-spec.yaml — do not edit manually

/** User resource */
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  createdAt: string;  // ISO 8601
}

/** GET /api/v1/users response */
export interface GetUsersResponse {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /api/v1/users request body */
export interface CreateUserRequest {
  email: string;
  name: string;
  role: 'admin' | 'user';
}
```

**Option B: Code generation tool** (large APIs, >= 20 endpoints)

```bash
# openapi-typescript
npm install -D openapi-typescript
npx openapi-typescript {api_spec_output}/api-spec.yaml -o src/types/api.generated.ts

# OR openapi-generator
npm install -D @openapitools/openapi-generator-cli
npx openapi-generator-cli generate \
  -i {api_spec_output}/api-spec.yaml \
  -g typescript-axios \
  -o src/types/generated/
```

Place all generated types in `src/types/`:
- `src/types/api.ts` — manually defined types
- `src/types/api.generated.ts` — auto-generated (gitignored if regenerated on build)
- `src/types/index.ts` — re-exports everything

---

### Step 4 — API Client Setup

Create a configured HTTP client in `src/services/api-client.ts`.

#### 4a. Base Client

```typescript
// src/services/api-client.ts
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { env } from '@/utils/env';

const apiClient: AxiosInstance = axios.create({
  baseURL: env.API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

#### 4b. Request Interceptor — Token Attach

```typescript
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken(); // from auth store
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

#### 4c. Response Interceptor — Token Refresh

```typescript
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else if (token) resolve(token);
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(apiClient(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        logout(); // clear auth state, redirect to login
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(normalizeError(error));
  },
);
```

#### 4d. Error Normalization

```typescript
export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>; // field-level errors
}

function normalizeError(error: AxiosError): ApiError {
  if (error.response?.data) {
    return error.response.data as ApiError;
  }
  if (error.request) {
    return {
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Network error. Please check your connection.',
    };
  }
  return {
    status: 0,
    code: 'REQUEST_SETUP_ERROR',
    message: error.message,
  };
}
```

#### 4e. Dev Logging

```typescript
if (import.meta.env.DEV) {
  apiClient.interceptors.request.use((config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`, config.data ?? '');
    return config;
  });
  apiClient.interceptors.response.use((response) => {
    console.log(`[API] ${response.status} ${response.config.url}`, response.data);
    return response;
  });
}
```

---

### Step 5 — API Functions

For each endpoint in `api-spec.yaml`, create a typed API function.

File organization: mirror the API resource groups.

```
src/services/
  api-client.ts         # Base client (Step 4)
  auth.service.ts       # Auth endpoints
  users.service.ts      # User CRUD endpoints
  products.service.ts   # Product endpoints
  ...
```

Example function pattern:

```typescript
// src/services/users.service.ts
import { apiClient } from './api-client';
import type { User, GetUsersResponse, CreateUserRequest } from '@/types/api';

export const usersService = {
  getUsers: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    signal?: AbortSignal;
  }): Promise<GetUsersResponse> => {
    const { data } = await apiClient.get<GetUsersResponse>('/users', {
      params,
      signal: params.signal,
    });
    return data;
  },

  getUserById: async (id: string, signal?: AbortSignal): Promise<User> => {
    const { data } = await apiClient.get<User>(`/users/${id}`, { signal });
    return data;
  },

  createUser: async (body: CreateUserRequest): Promise<User> => {
    const { data } = await apiClient.post<User>('/users', body);
    return data;
  },

  updateUser: async (id: string, body: Partial<CreateUserRequest>): Promise<User> => {
    const { data } = await apiClient.patch<User>(`/users/${id}`, body);
    return data;
  },

  deleteUser: async (id: string): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },
};
```

Requirements for every API function:
- Proper request and response types
- `AbortSignal` support on all GET-like operations
- Clear error propagation (errors bubble through the normalized error interceptor)

---

### Step 6 — State Management Layer

Set up a server-state management library for caching, background refetch, and optimistic updates. Choose based on architecture.md decision.

**TanStack Query (React)**:

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

```typescript
// src/stores/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 minutes
      gcTime: 10 * 60 * 1000,         // 10 minutes
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 1,
    },
  },
});
```

**Query Key Factory:**

```typescript
// src/stores/query-keys.ts
export const queryKeys = {
  users: {
    all: ['users'] as const,
    list: (params?: Record<string, unknown>) => ['users', 'list', params] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  products: {
    all: ['products'] as const,
    list: (params?: Record<string, unknown>) => ['products', 'list', params] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
  },
} as const;
```

**Query Hooks:**

```typescript
// src/hooks/useUsers.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersService } from '@/services/users.service';
import { queryKeys } from '@/stores/query-keys';

export function useUsers(params: { page?: number; pageSize?: number; search?: string }) {
  return useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: ({ signal }) => usersService.getUsers({ ...params, signal }),
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: ({ signal }) => usersService.getUserById(id, signal),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: usersService.createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
    // Optimistic update pattern:
    onMutate: async (newUser) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.all });
      // ... add optimistic user to cache ...
    },
    onError: (_err, _newUser, context) => {
      // Rollback optimistic update
      queryClient.setQueryData(queryKeys.users.all, context?.previousUsers);
    },
  });
}
```

**Cache invalidation strategy:**
- Mutations invalidate their resource's list queries
- Detail queries are invalidated when the specific resource is updated
- Related resources (e.g., user's posts) are invalidated cross-resource

---

### Step 7 — Authentication Flow

Implement the full auth lifecycle in `src/services/auth.service.ts` and `src/stores/auth.store.ts`.

```typescript
// src/services/auth.service.ts
export const authService = {
  login: async (credentials: { email: string; password: string }) => {
    const { data } = await apiClient.post<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/login',
      credentials
    );
    return data;
  },

  refreshToken: async (refreshToken: string) => {
    const { data } = await apiClient.post<{ accessToken: string; refreshToken: string }>(
      '/auth/refresh',
      { refreshToken }
    );
    return data;
  },

  logout: async () => {
    await apiClient.post('/auth/logout');
  },
};
```

**Token storage:**

```typescript
// src/utils/token-storage.ts
const TOKEN_KEY = 'auth_tokens';

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ access, refresh }));
}

export function getAccessToken(): string | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  return JSON.parse(stored).access;
}

export function getRefreshToken(): string | null {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  return JSON.parse(stored).refresh;
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}
```

**Auth context/provider:**

```typescript
// src/stores/auth.store.ts (Zustand example)
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
}
```

**Protected route guard:**

```typescript
// src/components/ProtectedRoute.tsx
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <Loading variant="fullpage" message="Checking authentication..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
```

---

### Step 8 — Mock Server

Set up MSW (Mock Service Worker) for API mocking during development and testing.

```bash
npm install -D msw
npx msw init public/ --save
```

**Mock handlers** for every endpoint:

```typescript
// src/mocks/handlers/users.handlers.ts
import { http, HttpResponse, delay } from 'msw';
import { env } from '@/utils/env';

export const usersHandlers = [
  http.get(`${env.API_BASE_URL}/users`, async ({ request }) => {
    await delay(200); // simulate network latency

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') ?? '10');

    return HttpResponse.json({
      data: mockUsers.slice((page - 1) * pageSize, page * pageSize),
      total: mockUsers.length,
      page,
      pageSize,
    });
  }),

  http.get(`${env.API_BASE_URL}/users/:id`, async ({ params }) => {
    await delay(150);
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json(
        { status: 404, code: 'NOT_FOUND', message: 'User not found' },
        { status: 404 }
      );
    }
    return HttpResponse.json(user);
  }),

  http.post(`${env.API_BASE_URL}/users`, async ({ request }) => {
    await delay(300);
    const body = await request.json();
    const newUser = { id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString() };
    mockUsers.push(newUser);
    return HttpResponse.json(newUser, { status: 201 });
  }),

  // ... handlers for PUT, PATCH, DELETE ...
];
```

**Error simulation modes:**

```typescript
// src/mocks/utils.ts
interface SimulateOptions {
  errorRate?: number;  // 0–1, probability of error response
  delay?: number;      // ms, override default delay
}

// Add to query params: ?_simulate=error&_errorStatus=500&_errorCode=SERVER_ERROR
export function shouldSimulateError(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.searchParams.get('_simulate') === 'error') {
    const status = parseInt(url.searchParams.get('_errorStatus') ?? '500');
    const code = url.searchParams.get('_errorCode') ?? 'SIMULATED_ERROR';
    return HttpResponse.json(
      { status, code, message: `Simulated ${code}` },
      { status }
    );
  }
  return null;
}
```

**Auth simulation:**

```typescript
// Simulate auth: any email/password works, returns fixed tokens
http.post(`${env.API_BASE_URL}/auth/login`, async () => {
  await delay(500);
  return HttpResponse.json({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    user: mockUsers[0],
  });
}),
```

**Enable mocks in dev:**

```typescript
// src/main.tsx (or main.ts for Vue/Svelte)
async function enableMocking() {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser');
    return worker.start({ onUnhandledRequest: 'warn' });
  }
}

enableMocking().then(() => {
  // Mount app
});
```

---

### Step 9 — Verification

Run the following checks:

```bash
# 1. Type check
npm run type-check
# → Must exit 0. All API types, hooks, and services must compile.

# 2. Lint
npm run lint
# → Must exit 0.

# 3. Start dev server with mocks
npm run dev
# → Verify mock server starts (MSW console log)
```

Manual verification checklist:
- [ ] All API functions compile without type errors
- [ ] Mock server responds to all endpoints with correct data shapes
- [ ] Mock server can simulate errors (network error, 401, 403, 404, 500)
- [ ] Token refresh cycle works: 401 triggers refresh, retries original request
- [ ] Concurrent 401s queue and resolve with single refresh call
- [ ] Logout clears tokens and redirects to login
- [ ] Protected route redirects unauthenticated users
- [ ] Abort controller cancels in-flight requests

---

### Step 10 — Report

Generate `{project-root}/api-client-report.md`:

```yaml
---
artifact_id: "api-client-report"
artifact_type: "report"
phase: "4.9"
status: "LOCKED"
created: "{iso-timestamp}"
endpoints_covered: 0
types_generated: true
mock_server_ready: true
auth_flow_verified: true
state_management_library: "@tanstack/react-query"
overrides:
  auth_interceptor: "refresh-queue"
---
```

Report body must include:
- Endpoint coverage summary (count, list of endpoints with service file mapping)
- Type generation approach and output files
- API client architecture (interceptors, error normalization)
- State management setup (query key factory, hooks created, cache strategy)
- Authentication flow diagram or description
- Mock server setup (MSW handlers per endpoint, error simulation modes)
- Verification results
- Known limitations

---

## Phase Complete

Lock the phase in `sprint-status.yaml`:

```yaml
phase_4_9: LOCKED
phase_4_9_artifact: "api-client-report.md"
phase_4_9_locked_at: "{iso-timestamp}"
```

This satisfies the gate condition for Phase 4.10 (which requires both 4.8 AND 4.9 LOCKED).
