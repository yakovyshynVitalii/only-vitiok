import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const spawn = vi.fn();
  return { spawn };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process"
  );

  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

function makeChild(options?: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = vi.fn((signal: string) => {
    child.exitCode = signal === "SIGKILL" ? 137 : 0;
    setImmediate(() => child.emit("close", child.exitCode));
  });

  const exitCode = options?.exitCode ?? 0;
  const stdout = options?.stdout ?? "";
  const stderr = options?.stderr ?? "";

  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.exitCode = exitCode;
    child.emit("close", exitCode);
  });

  return child;
}

describe("ollama-runner", () => {
  test("startOllamaServe returns existing session when Ollama already reachable", async () => {
    mocks.spawn.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));

    const mod = await import("~/server/utils/ollama-runner");
    const session = await mod.startOllamaServe("http://127.0.0.1:11434");

    expect(session.startedByRunner).toBe(false);
    expect(session.child).toBeNull();
    expect(session.logs.join("\n")).toContain("already running");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  test("startOllamaServe throws for unreachable remote URL", async () => {
    mocks.spawn.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    const mod = await import("~/server/utils/ollama-runner");
    await expect(
      mod.startOllamaServe("https://remote-ollama.example.com")
    ).rejects.toThrow("not local");
  });

  test("warmupOllamaModel sends generate request", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("~/server/utils/ollama-runner");
    const message = await mod.warmupOllamaModel("http://127.0.0.1:11434", "qwen");

    expect(message).toContain("Model warmed up");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  test("warmupOllamaModel throws when API returns error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "fail" }))
    );

    const mod = await import("~/server/utils/ollama-runner");
    await expect(
      mod.warmupOllamaModel("http://127.0.0.1:11434", "qwen")
    ).rejects.toThrow("Failed to warm up model");
  });

  test("stopOllamaModel runs ollama stop and returns logs", async () => {
    mocks.spawn.mockReset();
    mocks.spawn.mockImplementation(() => makeChild({ stdout: "stopped\n" }));

    const mod = await import("~/server/utils/ollama-runner");
    const result = await mod.stopOllamaModel("qwen");

    expect(mocks.spawn).toHaveBeenCalledWith(
      "ollama",
      ["stop", "qwen"],
      expect.any(Object)
    );
    expect(result.logs.join("\n")).toContain("Model stopped");
  });

  test("stopOllamaServe returns info when serve was not started by runner", async () => {
    const mod = await import("~/server/utils/ollama-runner");
    const session = {
      startedByRunner: false,
      child: null,
      logs: [],
    } as unknown as Parameters<typeof mod.stopOllamaServe>[0];
    const result = await mod.stopOllamaServe({
      ...session,
    });

    expect(result.logs.join("\n")).toContain("was not started");
  });

  test("stopOllamaServe terminates managed process", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      exitCode: number | null;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      setImmediate(() => child.emit("close", 0));
    });

    const mod = await import("~/server/utils/ollama-runner");
    const session = {
      startedByRunner: true,
      child,
      logs: [],
    } as unknown as Parameters<typeof mod.stopOllamaServe>[0];
    const result = await mod.stopOllamaServe(session);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result.logs.join("\n")).toContain("stopped");
  });
});
