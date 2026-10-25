import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createAppRouter } from "./app/router";
import { SessionGate } from "./features/auth/SessionGate";
import { PWAUpdateBanner } from "./components/app/PWAUpdateBanner";
import { useTheme } from "./lib/theme";

// App keeps authentication outside the stable router and shared QueryClient.
function App() {
  useTheme();
  const [router] = useState(createAppRouter);
  return (
    <>
      <PWAUpdateBanner />
      <SessionGate>{({ logout, hasToken }) => (
        <RouterProvider router={router} context={{ logout: hasToken ? logout : undefined }} />
      )}</SessionGate>
    </>
  );
}

export default App;
