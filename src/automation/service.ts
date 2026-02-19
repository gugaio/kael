import { PersistentScheduler, type SchedulerJob } from "./persistent-scheduler.js";

export class AutomationService {
  constructor(private readonly scheduler: PersistentScheduler) {}

  listSchedules(): SchedulerJob[] {
    return this.scheduler.listJobs();
  }

  getSchedule(id: string): SchedulerJob | null {
    return this.scheduler.getJob(id);
  }

  async upsertIntervalSchedule(params: {
    id: string;
    type: string;
    intervalMs: number;
    enabled: boolean;
  }): Promise<SchedulerJob> {
    await this.scheduler.upsertIntervalJob(params);
    const schedule = this.scheduler.getJob(params.id);
    if (!schedule) {
      throw new Error("schedule not found after upsert");
    }
    return schedule;
  }

  async upsertCronSchedule(params: {
    id: string;
    type: string;
    cronExpr: string;
    enabled: boolean;
  }): Promise<SchedulerJob> {
    await this.scheduler.upsertCronJob(params);
    const schedule = this.scheduler.getJob(params.id);
    if (!schedule) {
      throw new Error("schedule not found after upsert");
    }
    return schedule;
  }

  async setScheduleEnabled(id: string, enabled: boolean): Promise<SchedulerJob | null> {
    return this.scheduler.setJobEnabled(id, enabled);
  }
}
