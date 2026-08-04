import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core"
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core"
import { WarningCircleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { LoginPage } from "./features/auth/LoginPage"
import { errorMessage } from "./formatting"
import { authQueryOptions } from "./queries"
import { Dashboard } from "./shell/Dashboard"

export default function App() {
  const authQuery = useQuery(authQueryOptions())
  const computedColorScheme = useComputedColorScheme("light")
  const { toggleColorScheme } = useMantineColorScheme()

  if (authQuery.isPending) {
    return <Center mih="100vh"><Stack align="center" gap="sm"><Loader type="dots" /><Text size="sm" c="dimmed">Loading Koliko</Text></Stack></Center>
  }

  if (authQuery.isError) {
    return (
      <Center mih="100vh">
        <Alert color="rust" icon={<WarningCircleIcon />} title="Koliko could not be loaded">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(authQuery.error, "Authentication status could not be loaded")}</Text>
            <Button variant="light" onClick={() => void authQuery.refetch()}>Retry</Button>
          </Stack>
        </Alert>
      </Center>
    )
  }

  if (!authQuery.data.authenticated) {
    return (
      <LoginPage
        hasPasskey={authQuery.data.hasPasskey}
        colorScheme={computedColorScheme}
        onToggleColorScheme={toggleColorScheme}
      />
    )
  }

  return <Dashboard />
}
