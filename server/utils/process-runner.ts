import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createError } from "h3";
import { ROOT_DIR } from "./constants";

interface ScriptResult {
  output: string;
}

const taskState = {
  runningTask: "",
  child: null as ChildProcessWithoutNullStreams | null,
  stopRequested: false,
};

export function getTaskStatus() {
  return {
    runningTask: taskState.runningTask || null,
    isBusy: Boolean(taskState.runningTask),
    stopRequested: taskState.stopRequested,
  };
}

export async function runScriptTask(taskName: string, scriptPath: string): Promise<ScriptResult> {
  if (taskState.runningTask) {
    throw createError({
      statusCode: 409,
      statusMessage: `Another task is already running: ${taskState.runningTask}`,
    });
  }

  taskState.runningTask = taskName;
  taskState.stopRequested = false;

  try {
    const fullScriptPath = path.resolve(ROOT_DIR, scriptPath);
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [fullScriptPath], {
        cwd: ROOT_DIR,
        env: process.env,
      });
      taskState.child = child;

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        const merged = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

        if (taskState.stopRequested) {
          reject(
            createError({
              statusCode: 499,
              statusMessage: merged
                ? `Task "${taskName}" was stopped by user request.\n${merged}`
                : `Task "${taskName}" was stopped by user request.`,
            })
          );
          return;
        }

        if (code !== 0) {
          reject(
            createError({
              statusCode: 500,
              statusMessage: merged || `Script exited with code ${code}`,
            })
          );
          return;
        }

        resolve(merged || "Script completed with no output.");
      });
    });

    return { output };
  } finally {
    taskState.child = null;
    taskState.stopRequested = false;
    taskState.runningTask = "";
  }
}

export function stopRunningTask() {
  if (!taskState.runningTask || !taskState.child) {
    return {
      stopped: false,
      runningTask: null as string | null,
    };
  }

  const currentTask = taskState.runningTask;
  taskState.stopRequested = true;

  const child = taskState.child;
  child.kill("SIGTERM");

  const hardStopTimer = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 4000);
  hardStopTimer.unref();

  return {
    stopped: true,
    runningTask: currentTask,
  };
}
