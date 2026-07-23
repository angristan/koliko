import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createTheme, DEFAULT_THEME, MantineProvider } from "@mantine/core"
import "@mantine/core/styles.css"
import "@mantine/charts/styles.css"
import "./styles.css"
import App from "./App"

const fontFamily = `'Inter Variable', ${DEFAULT_THEME.fontFamily}`

const theme = createTheme({
  primaryColor: "tangerine",
  primaryShade: { light: 5, dark: 4 },
  defaultRadius: "md",
  fontFamily,
  headings: {
    fontFamily,
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.15", fontWeight: "700" },
      h2: { fontSize: "1.125rem", lineHeight: "1.3", fontWeight: "700" },
      h3: { fontSize: "1rem", lineHeight: "1.4", fontWeight: "600" }
    }
  },
  fontSizes: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.25rem" },
  lineHeights: { xs: "1.35", sm: "1.45", md: "1.5", lg: "1.4", xl: "1.3" },
  fontWeights: { regular: "400", medium: "500", bold: "700" },
  spacing: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
  radius: { xs: "0.25rem", sm: "0.25rem", md: "0.5rem", lg: "1rem", xl: "1.5rem" },
  colors: {
    tangerine: [
      "#fff7e8",
      "#ffedcc",
      "#ffdda3",
      "#ffc66b",
      "#ffa72e",
      "#ff8205",
      "#ef6b00",
      "#b75002",
      "#933800",
      "#6f2600"
    ]
  },
  respectReducedMotion: true
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
