import { Alert, Badge, Box, Button, Center, Code, Drawer, Group, Loader, Stack, Text } from "@mantine/core"
import { WarningCircleIcon } from "@phosphor-icons/react"
import type { SessionDetailResponse } from "../../../shared/api"
import { compactNumber, errorMessage, formatDuration, money } from "../../formatting"

export function SessionDrawer({
  opened,
  detail,
  pending,
  error,
  onClose,
  onRetry
}: {
  readonly opened: boolean
  readonly detail: SessionDetailResponse | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly onClose: () => void
  readonly onRetry: () => void
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      closeButtonProps={{ "aria-label": "Close session details" }}
      title={detail ? (
        <Box>
          <Text fw={700}>{detail.repository}</Text>
          <Text size="xs" c="dimmed">{detail.truncated ? `${detail.events.length} latest events` : `${detail.events.length} events`}</Text>
        </Box>
      ) : "Session details"}
      classNames={{ content: "session-drawer", header: "session-drawer-header" }}
    >
      {pending && <Center mih={240}><Loader type="dots" /></Center>}
      {error !== null && (
        <Alert color="rust" icon={<WarningCircleIcon />} title="Session unavailable">
          <Stack gap="sm">
            <Text size="sm">{errorMessage(error, "Session could not be loaded")}</Text>
            <Button variant="light" onClick={onRetry}>Retry</Button>
          </Stack>
        </Alert>
      )}
      {detail?.truncated && <Alert color="honey" mb="md">Showing the latest 500 events.</Alert>}
      <Stack gap={0} className="event-log">
        {detail?.events.map((event) => (
          <Box className="event-row" key={event.id}>
            <span className="event-dot" />
            <Box className="event-content">
              <Group justify="space-between" gap="md" align="flex-start">
                <Text size="sm" fw={600} tt="capitalize">{event.type.replaceAll("_", " ")}</Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </Text>
              </Group>
              <Group gap="xs" mt="xs">
                {event.toolName && <Code>{event.toolName}</Code>}
                {event.model && <Badge variant="light" color="sky">{event.provider}/{event.model}</Badge>}
                {event.tokens !== undefined && <Badge variant="light" color="sky">{compactNumber.format(event.tokens)} tokens</Badge>}
                {event.cost !== undefined && <Badge variant="light" color="honey">{money.format(event.cost)}</Badge>}
                {event.durationMs !== undefined && <Badge variant="light" color="sage">{formatDuration(event.durationMs)}</Badge>}
                {event.status === "error" && <Badge color="rust" variant="light">error</Badge>}
              </Group>
            </Box>
          </Box>
        ))}
      </Stack>
    </Drawer>
  )
}
