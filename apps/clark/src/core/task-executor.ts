import type { Logger } from 'pino';

import type { CapabilityRegistry } from './capability-registry.js';
import type { TaskRequest, TaskResult } from '../protocol/types.js';
import { ClarkError, serializeError } from '../utils/errors.js';

export class TaskExecutor {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly logger: Logger,
    private readonly defaultTimeoutMs: number,
  ) {}

  async execute(task: TaskRequest): Promise<TaskResult> {
    const startedAt = Date.now();
    const capability = this.registry.get(task.capability);

    if (!capability) {
      return this.buildErrorResult(
        task,
        startedAt,
        new ClarkError('unknown_capability', `Capability not found: ${task.capability}`),
      );
    }

    const parsedInput = capability.inputSchema.safeParse(task.input);
    if (!parsedInput.success) {
      return this.buildErrorResult(
        task,
        startedAt,
        new ClarkError('invalid_input', 'Task input did not match capability schema', parsedInput.error.flatten()),
      );
    }

    const timeoutMs = task.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    this.logger.info({
      event: 'task.started',
      taskId: task.id,
      capability: task.capability,
    }, 'Task execution started');

    try {
      const output = await capability.execute(parsedInput.data, { signal: controller.signal });

      const result: TaskResult = {
        taskId: task.id,
        capability: task.capability,
        success: true,
        output,
        durationMs: Date.now() - startedAt,
      };

      this.logger.info({
        event: 'task.succeeded',
        taskId: task.id,
        capability: task.capability,
        durationMs: result.durationMs,
      }, 'Task execution finished');

      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        return this.buildErrorResult(
          task,
          startedAt,
          new ClarkError('timeout', `Task timed out after ${timeoutMs}ms`),
        );
      }

      return this.buildErrorResult(task, startedAt, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildErrorResult(task: TaskRequest, startedAt: number, error: unknown): TaskResult {
    const serialized = serializeError(error, 'capability_error');
    const result: TaskResult = {
      taskId: task.id,
      capability: task.capability,
      success: false,
      error: serialized,
      durationMs: Date.now() - startedAt,
    };

    this.logger.error({
      event: 'task.failed',
      taskId: task.id,
      capability: task.capability,
      durationMs: result.durationMs,
      error: serialized,
    }, 'Task execution failed');

    return result;
  }
}
