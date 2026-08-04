import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/inter"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MantineProvider } from "@mantine/core"
import "@mantine/core/styles.css"
import "@mantine/charts/styles.css"
import { cssVariablesResolver, theme } from "./theme"
import "./styles.css"
import "./styles/shell.css"
import "./styles/components.css"
import "./styles/analytics.css"
import "./styles/sessions.css"
import "./styles/settings.css"
import "./styles/auth.css"
import "./styles/responsive.css"
import App from "./App"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
})

const root = document.getElementById("root")
if (!root) throw new Error("Dashboard root element is missing")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="auto">
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>
)
