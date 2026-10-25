import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { createAppRouter } from "./app/router";
import { SessionGate } from "./features/auth/SessionGate";

// App keeps authentication outside the stable router and shared QueryClient.
function App() {
  const [router] = useState(createAppRouter);
  return (
    <SessionGate>{({ logout, hasToken }) => (
      <RouterProvider router={router} context={{ logout: hasToken ? logout : undefined }} />
    )}</SessionGate>
  );
}

export default App;
