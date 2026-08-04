import { useState } from "react"
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip
} from "@mantine/core"
import {
  LockKeyIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  WarningCircleIcon
} from "@phosphor-icons/react"
import { Brand } from "../../components/Brand"
import { errorMessage } from "../../formatting"
import { useLoginMutation, useRegisterPasskeyMutation } from "../../queries"

export function LoginPage({
  hasPasskey,
  colorScheme,
  onToggleColorScheme
}: {
  readonly hasPasskey: boolean
  readonly colorScheme: "light" | "dark"
  readonly onToggleColorScheme: () => void
}) {
  const [token, setToken] = useState("")
  const [passkeyName, setPasskeyName] = useState("Primary passkey")
  const loginMutation = useLoginMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const error = loginMutation.error ?? registerMutation.error
  const busy = loginMutation.isPending || registerMutation.isPending

  const act = async () => {
    try {
      if (hasPasskey) await loginMutation.mutateAsync()
      else await registerMutation.mutateAsync({ name: passkeyName.trim(), bootstrapToken: token })
    } catch {
      // The mutation keeps the typed error for the alert below.
    }
  }

  return (
    <main className="auth-shell">
      <Box className="auth-layout">
        <Group className="auth-brand" justify="space-between" wrap="nowrap">
          <Brand />
          <Group gap="xs" wrap="nowrap" className="appearance-controls">
            <Tooltip label={`Use ${colorScheme === "dark" ? "light" : "dark"} theme`}>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={`Use ${colorScheme === "dark" ? "light" : "dark"} theme`}
                onClick={onToggleColorScheme}
              >
                {colorScheme === "dark" ? <SunIcon /> : <MoonIcon />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Paper radius="lg" className="auth-card">
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault()
              void act()
            }}
          >
            <Stack gap="lg">
              <Group gap="md" wrap="nowrap" align="flex-start" className="auth-heading">
                <ThemeIcon size={40} radius="md" variant="light" color="honey">
                  {hasPasskey ? <LockKeyIcon size={20} /> : <ShieldCheckIcon size={20} />}
                </ThemeIcon>
                <Box>
                  <Title order={1}>{hasPasskey ? "Sign in to Koliko" : "Set up Koliko"}</Title>
                  <Text c="dimmed" size="sm" mt={4}>
                    {hasPasskey
                      ? "Use your passkey to open your dashboard."
                      : "Enter the bootstrap token configured for this Worker. You’ll create a passkey next."}
                  </Text>
                </Box>
              </Group>

              {error && <Alert color="rust" icon={<WarningCircleIcon />} title="Authentication failed">{errorMessage(error, "Authentication failed")}</Alert>}

              {!hasPasskey && (
                <Stack gap="sm">
                  <TextInput
                    label="Passkey name"
                    value={passkeyName}
                    onChange={(event) => setPasskeyName(event.currentTarget.value)}
                    placeholder="Primary passkey"
                    size="md"
                    maxLength={80}
                  />
                  <PasswordInput
                    label="Bootstrap token"
                    description="Configured in your Worker environment"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.currentTarget.value)}
                    placeholder="BOOTSTRAP_TOKEN"
                    size="md"
                  />
                </Stack>
              )}

              <Button
                className="auth-submit"
                type="submit"
                variant="filled"
                color="sage"
                size="md"
                loading={busy}
                disabled={!hasPasskey && (token.length === 0 || passkeyName.trim().length === 0)}
                leftSection={hasPasskey ? <LockKeyIcon size={18} /> : <ShieldCheckIcon size={18} />}
                fullWidth
              >
                {hasPasskey ? "Sign in with passkey" : "Create passkey"}
              </Button>
            </Stack>
          </Box>
        </Paper>
      </Box>
    </main>
  )
}
