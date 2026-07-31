/**
 * A tiny in-memory stand-in for the Supabase client, for unit-testing the money
 * paths without a database (there is none in CI). It supports only the query
 * shapes this codebase actually uses - select/insert/update/delete with
 * eq/is/in/contains/order/limit, `maybeSingle`/`single`, awaiting the builder
 * directly, and `rpc` - and it applies the filters for real, so a test can prove
 * that an action scoped its write (e.g. "update ... where payment_intent_id is
 * null") rather than just that it called update.
 *
 * Errors are opt-in per `table.operation` key, so a test can make exactly one
 * read or write fail and assert the action reports it instead of pressing on.
 */

export interface FakeRow {
  [column: string]: unknown;
}

/** The shape PostgrestError has in the bits of it this app reads. */
export interface FakeError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface FakeResult {
  data: unknown;
  error: FakeError | null;
}

export type FakeOperation = "select" | "insert" | "update" | "delete" | "upsert";

export interface FakeFilter {
  kind: "eq" | "is" | "in" | "contains" | "not" | "lt";
  column: string;
  value: unknown;
}

export interface FakeCall {
  table: string;
  operation: FakeOperation;
  filters: FakeFilter[];
  payload?: unknown;
}

export interface FakeRpcCall {
  name: string;
  args: unknown;
}

export interface FakeQuery extends PromiseLike<FakeResult> {
  select(columns?: string): FakeQuery;
  insert(value: unknown): FakeQuery;
  /** Honours onConflict + ignoreDuplicates for real, so dedupe can be tested. */
  upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): FakeQuery;
  update(value: unknown): FakeQuery;
  delete(): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  /** Models `.not(column, "is", null)`; the operator argument is ignored. */
  not(column: string, operator: string, value: unknown): FakeQuery;
  lt(column: string, value: number): FakeQuery;
  in(column: string, values: unknown[]): FakeQuery;
  contains(column: string, value: unknown): FakeQuery;
  order(column: string, options?: { ascending?: boolean }): FakeQuery;
  limit(count: number): FakeQuery;
  maybeSingle(): Promise<FakeResult>;
  single(): Promise<FakeResult>;
}

export interface FakeUser {
  id: string;
  email_confirmed_at?: string | null;
}

export interface FakeClientOptions {
  /** Fixture rows, by table name. Copied, so a test's fixture is never mutated. */
  tables?: Record<string, FakeRow[]>;
  /** Failures to return, keyed "table.operation" (e.g. "payments.select"). */
  errors?: Record<string, FakeError>;
  /** Results for `rpc(name)`. An un-stubbed rpc returns an error, never null data. */
  rpc?: Record<string, { data?: unknown; error?: FakeError | null }>;
  /** What `auth.getUser()` reports. */
  user?: FakeUser | null;
}

export interface FakeClient {
  from(table: string): FakeQuery;
  rpc(name: string, args?: unknown): Promise<FakeResult>;
  auth: { getUser(): Promise<{ data: { user: FakeUser | null }; error: null }> };
  /** Every select/insert/update/delete run, in order. */
  calls: FakeCall[];
  rpcCalls: FakeRpcCall[];
  /** Live rows, so a test can assert what a write actually left behind. */
  rows(table: string): FakeRow[];
}

function subsetOf(candidate: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return candidate === expected;
  if (candidate === null || typeof candidate !== "object") return false;
  const target = candidate as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
    subsetOf(target[key], value),
  );
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const tables: Record<string, FakeRow[]> = {};
  for (const [name, rows] of Object.entries(options.tables ?? {})) {
    tables[name] = rows.map((row) => ({ ...row }));
  }
  const calls: FakeCall[] = [];
  const rpcCalls: FakeRpcCall[] = [];

  function matches(row: FakeRow, filters: FakeFilter[]): boolean {
    return filters.every((filter) => {
      const actual = row[filter.column] ?? null;
      switch (filter.kind) {
        case "in":
          return Array.isArray(filter.value) && filter.value.includes(actual);
        case "contains":
          return subsetOf(actual, filter.value);
        // Only the `.not(col, "is", null)` form is modelled - the one shape the
        // app actually uses. Anything else would be a fake that lies.
        case "not":
          return actual !== filter.value;
        case "lt":
          return typeof actual === "number" && typeof filter.value === "number" && actual < filter.value;
        default:
          return actual === filter.value;
      }
    });
  }

  function from(table: string): FakeQuery {
    const filters: FakeFilter[] = [];
    let operation: FakeOperation = "select";
    let payload: unknown;
    let limitTo: number | null = null;
    let orderBy: { column: string; ascending: boolean } | null = null;
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

    function selected(): FakeRow[] {
      let out = (tables[table] ?? []).filter((row) => matches(row, filters));
      if (orderBy) {
        const { column, ascending } = orderBy;
        out = [...out].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (limitTo !== null) out = out.slice(0, limitTo);
      return out;
    }

    function run(): FakeResult {
      calls.push({ table, operation, filters: [...filters], payload });
      const failure = options.errors?.[`${table}.${operation}`];
      if (failure) return { data: null, error: failure };

      if (operation === "insert") {
        const incoming = (Array.isArray(payload) ? payload : [payload]) as FakeRow[];
        const inserted = incoming.map((row) => ({ ...row }));
        tables[table] = [...(tables[table] ?? []), ...inserted];
        return { data: inserted, error: null };
      }
      if (operation === "upsert") {
        const incoming = (Array.isArray(payload) ? payload : [payload]) as FakeRow[];
        const keys = (upsertOpts.onConflict ?? "id").split(",").map((k) => k.trim());
        const existing = tables[table] ?? [];
        const inserted: FakeRow[] = [];
        for (const row of incoming) {
          const clash = existing.find((r) => keys.every((k) => r[k] === row[k]));
          if (clash) {
            // PostgREST returns only the rows it actually inserted, which is how
            // the caller distinguishes "queued" from "already queued".
            if (!upsertOpts.ignoreDuplicates) Object.assign(clash, row);
            continue;
          }
          const copy = { ...row };
          existing.push(copy);
          inserted.push(copy);
        }
        tables[table] = existing;
        return { data: inserted, error: null };
      }
      if (operation === "update") {
        const touched = selected();
        for (const row of touched) Object.assign(row, payload as FakeRow);
        return { data: touched, error: null };
      }
      if (operation === "delete") {
        const removed = selected();
        tables[table] = (tables[table] ?? []).filter((row) => !removed.includes(row));
        return { data: removed, error: null };
      }
      return { data: selected(), error: null };
    }

    function first(): Promise<FakeResult> {
      const result = run();
      if (result.error) return Promise.resolve(result);
      const list = result.data as FakeRow[];
      return Promise.resolve({ data: list.length > 0 ? list[0] : null, error: null });
    }

    const query: FakeQuery = {
      select: () => query,
      insert(value: unknown) {
        operation = "insert";
        payload = value;
        return query;
      },
      upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        operation = "upsert";
        payload = value;
        upsertOpts = options ?? {};
        return query;
      },
      update(value: unknown) {
        operation = "update";
        payload = value;
        return query;
      },
      delete() {
        operation = "delete";
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push({ kind: "eq", column, value });
        return query;
      },
      is(column: string, value: unknown) {
        filters.push({ kind: "is", column, value });
        return query;
      },
      not(column: string, _operator: string, value: unknown) {
        filters.push({ kind: "not", column, value });
        return query;
      },
      lt(column: string, value: number) {
        filters.push({ kind: "lt", column, value });
        return query;
      },
      in(column: string, values: unknown[]) {
        filters.push({ kind: "in", column, value: values });
        return query;
      },
      contains(column: string, value: unknown) {
        filters.push({ kind: "contains", column, value });
        return query;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy = { column, ascending: opts?.ascending ?? true };
        return query;
      },
      limit(count: number) {
        limitTo = count;
        return query;
      },
      maybeSingle: first,
      single(): Promise<FakeResult> {
        const result = run();
        if (result.error) return Promise.resolve(result);
        const list = result.data as FakeRow[];
        if (list.length !== 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          });
        }
        return Promise.resolve({ data: list[0], error: null });
      },
      then<TResult1 = FakeResult, TResult2 = never>(
        onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(run()).then(onfulfilled, onrejected);
      },
    };
    return query;
  }

  return {
    from,
    rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      const stubbed = options.rpc?.[name];
      if (!stubbed) {
        return Promise.resolve({
          data: null,
          error: { message: `rpc ${name} was called but not stubbed in this test` },
        });
      }
      return Promise.resolve({ data: stubbed.data ?? null, error: stubbed.error ?? null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: options.user ?? null }, error: null }),
    },
    calls,
    rpcCalls,
    rows: (table: string) => tables[table] ?? [],
  };
}
