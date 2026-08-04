import { Box, Group, Text } from "@mantine/core"

function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="logo-stem" d="M7 3.5v17" />
      <path className="logo-branch" d="m8 12 10-7.5M8 12l10 7.5" />
      <circle className="logo-node-center" cx="8" cy="12" r="2" />
      <circle className="logo-node-end" cx="18" cy="4.5" r="1.5" />
      <circle className="logo-node-end" cx="18" cy="19.5" r="1.5" />
    </svg>
  )
}

export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Group gap="sm" wrap="nowrap" className="brand">
      <span className="brand-mark"><LogoMark /></span>
      {!compact && (
        <Box>
          <Text fw={700} lh={1.05} className="brand-name">koliko</Text>
          <Text size="xs" c="dimmed" mt={3}>Agent analytics</Text>
        </Box>
      )}
    </Group>
  )
}
