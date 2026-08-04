import { Box, Button, Code, Group, Table, Text, ThemeIcon } from "@mantine/core"
import { ArrowRightIcon, ListBulletsIcon, TerminalWindowIcon } from "@phosphor-icons/react"
import type { DashboardResponse } from "../../../shared/api"
import { EmptyState, Panel } from "../../components/DashboardPrimitives"
import { compactNumber, integer, money } from "../../formatting"

export function SessionsPage({ dashboard, setSessionId }: {
  readonly dashboard: DashboardResponse | undefined
  readonly setSessionId: (sessionId: string) => void
}) {
  return (
    <Panel title="Recent sessions" detail="Latest 50">
      {(dashboard?.sessions.length ?? 0) === 0 ? (
        <EmptyState icon={<ListBulletsIcon />} title="No sessions yet" detail="Recent agent sessions will show up here once data arrives." />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Repository</Table.Th>
                <Table.Th>Last activity</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th ta="right">Turns</Table.Th>
                <Table.Th ta="right">Tokens</Table.Th>
                <Table.Th ta="right">Cost</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dashboard?.sessions.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon size="sm" variant="light" color="sky" radius="sm"><TerminalWindowIcon /></ThemeIcon>
                      <Text size="sm" fw={600}>{row.repository}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{new Date(row.endedAt).toLocaleString()}</Text></Table.Td>
                  <Table.Td><Code>{row.model}</Code></Table.Td>
                  <Table.Td ta="right">{integer.format(row.turns)}</Table.Td>
                  <Table.Td ta="right">{compactNumber.format(row.tokens)}</Table.Td>
                  <Table.Td ta="right">{money.format(row.cost)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-sm" variant="subtle" rightSection={<ArrowRightIcon />} onClick={() => setSessionId(row.id)}>Inspect</Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Panel>
  )
}
