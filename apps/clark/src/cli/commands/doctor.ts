import { loadSettings } from '../../config/settings.js';
import { runDoctor } from '../../core/doctor.js';

export async function runDoctorCommand(): Promise<void> {
  const settings = loadSettings();
  const report = await runDoctor(settings);

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}
