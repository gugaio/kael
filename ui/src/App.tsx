import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ChatPage } from "./pages/ChatPage";
import { DailyChatPage } from "./pages/DailyChatPage";
import { ExecSessionsPage } from "./pages/ExecSessionsPage";
import { HealthPage } from "./pages/HealthPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { JobsPage } from "./pages/JobsPage";
import { OpsPage } from "./pages/OpsPage";
import { StreamDetailsPage } from "./pages/StreamDetailsPage";
import { StreamPlaygroundPage } from "./pages/StreamPlaygroundPage";
import { StreamWatchDetailPage } from "./pages/StreamWatchDetailPage";
import { StreamWatchPage } from "./pages/StreamWatchPage";
import { StreamsPage } from "./pages/StreamsPage";
import { PlansPage } from "./pages/PlansPage";
import { SchedulesPage } from "./pages/SchedulesPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/chat/daily" element={<DailyChatPage />} />
      <Route
        path="*"
        element={(
          <AppShell>
            <Routes>
              <Route path="/" element={<OpsPage />} />
              <Route path="/plans" element={<PlansPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/jobs/:jobId" element={<JobDetailPage />} />
              <Route path="/streams" element={<StreamsPage />} />
              <Route path="/streams/watch" element={<StreamWatchPage />} />
              <Route path="/streams/watch/:watchId" element={<StreamWatchDetailPage />} />
              <Route path="/streams/:originId/details" element={<StreamDetailsPage />} />
              <Route path="/streams/:originId/playground" element={<StreamPlaygroundPage />} />
              <Route path="/exec" element={<ExecSessionsPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/health" element={<HealthPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        )}
      />
    </Routes>
  );
}
