import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createTheme, MantineProvider } from "@mantine/core"
import "@mantine/core/styles.css"
import "@mantine/charts/styles.css"
import "./styles.css"
import App from "./App"

const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
  fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  headings: {
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: "720"
  },
  colors: {
    indigo: [
      "#eef2ff",
      "#e0e7ff",
      "#c7d2fe",
      "#a5b4fc",
      "#818cf8",
      "#6366f1",
      "#4f46e5",
      "#4338ca",
      "#3730a3",
      "#312e81"
    ]
  }
})

const root = document.getElementById("root")
if (!root) throw new Error("Dashboard root element is missing")

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>
)
