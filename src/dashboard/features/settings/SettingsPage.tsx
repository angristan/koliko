import { useState } from "react"
import {
  Alert, Badge, Box, Button, Center, Code, CopyButton, Group, Loader, Modal, Paper, Stack, Text, TextInput
} from "@mantine/core"
import {
  CheckCircleIcon, CopyIcon, KeyIcon, ShieldCheckIcon, SignOutIcon, WarningCircleIcon
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import type { ApiKeySummary, PasskeySummary } from "../../../shared/api"
import { errorMessage } from "../../formatting"
import { apiKeyRevocationMessage } from "../../presentation"
import {
  apiKeysQueryOptions,
  passkeysQueryOptions,
  useCreateApiKeyMutation,
  useLogoutMutation,
  useRegisterPasskeyMutation,
  useRemovePasskeyMutation,
  useRevokeApiKeyMutation
} from "../../queries"

export function SettingsPage() {
  const apiKeysQuery = useQuery(apiKeysQueryOptions())
  const passkeysQuery = useQuery(passkeysQueryOptions())
  const createMutation = useCreateApiKeyMutation()
  const revokeMutation = useRevokeApiKeyMutation()
  const registerMutation = useRegisterPasskeyMutation()
  const removePasskeyMutation = useRemovePasskeyMutation()
  const logoutMutation = useLogoutMutation()
  const [keyName, setKeyName] = useState("Local Pi collector")
  const [passkeyName, setPasskeyName] = useState("")
  const [createdKey, setCreatedKey] = useState<string>()
  const [keyMessage, setKeyMessage] = useState<string>()
  const [passkeyToRemove, setPasskeyToRemove] = useState<PasskeySummary>()
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<ApiKeySummary>()
  const keys = apiKeysQuery.data?.keys ?? []
  const passkeys = passkeysQuery.data?.passkeys ?? []

  const createKey = () => {
    createMutation.mutate(keyName, {
      onSuccess: (result) => {
        setCreatedKey(result.key)
        setKeyMessage("Copy this key now. It will not be shown again.")
      },
      onError: (cause) => setKeyMessage(errorMessage(cause, "API key could not be created"))
    })
  }

  const addPasskey = () => {
    registerMutation.mutate({ name: passkeyName.trim() }, {
      onSuccess: () => setPasskeyName("")
    })
  }

  const confirmPasskeyRemoval = () => {
    if (!passkeyToRemove) return
    removePasskeyMutation.mutate(passkeyToRemove.id, {
      onSuccess: () => setPasskeyToRemove(undefined)
    })
  }

  const confirmApiKeyRevocation = () => {
    if (!apiKeyToRevoke) return
    revokeMutation.mutate(apiKeyToRevoke.id, {
      onSuccess: () => setApiKeyToRevoke(undefined),
      onError: (cause) => setKeyMessage(errorMessage(cause, "API key could not be revoked"))
    })
  }

  return (
    <>
      <Stack gap={0} className="settings-page">
        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Collector keys</Text>
            <Text size="xs" c="dimmed" mt={3}>Create one independently revocable key for each collector. Only hashes are stored.</Text>
          </Box>

          {apiKeysQuery.error !== null && <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>{errorMessage(apiKeysQuery.error, "API keys could not be loaded")}</Alert>}
          {keyMessage && <Alert mb="md" color={createdKey ? "sage" : "rust"} icon={createdKey ? <KeyIcon /> : <WarningCircleIcon />}>{keyMessage}</Alert>}

          {createdKey && (
            <Paper withBorder radius="md" p="md" mb="md" className="created-key">
              <Group justify="space-between" wrap="nowrap">
                <Code className="created-key-value">{createdKey}</Code>
                <CopyButton value={createdKey} timeout={1600}>
                  {({ copied, copy }) => (
                    <Button variant="light" color={copied ? "sage" : "sky"} onClick={copy} leftSection={copied ? <CheckCircleIcon /> : <CopyIcon />}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            </Paper>
          )}

          <Group align="flex-end" wrap="nowrap" className="settings-create-row">
            <TextInput label="Key name" value={keyName} onChange={(event) => setKeyName(event.currentTarget.value)} flex={1} maxLength={80} />
            <Button
              className="accent-action"
              variant="filled"
              color="sage"
              loading={createMutation.isPending}
              disabled={keyName.trim().length === 0}
              onClick={createKey}
              leftSection={<KeyIcon />}
            >Create key</Button>
          </Group>

          <Stack gap={0} className="settings-list">
            {apiKeysQuery.isPending && <Center mih={72}><Loader type="dots" /></Center>}
            {keys.map((key) => (
              <Group key={key.id} justify="space-between" wrap="nowrap" className="settings-list-row">
                <Box miw={0}>
                  <Group gap="xs" className="settings-resource-heading">
                    <Text size="sm" fw={600} className="settings-resource-name">{key.name}</Text>
                    {key.revokedAt && <Badge size="xs" variant="light" color="gray">Revoked</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed" className="settings-resource-meta">{key.prefix}… · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : "never used"}</Text>
                </Box>
                {!key.revokedAt && (
                  <Button
                    variant="light"
                    color="rust"
                    loading={revokeMutation.isPending && revokeMutation.variables === key.id}
                    onClick={() => setApiKeyToRevoke(key)}
                  >Revoke</Button>
                )}
              </Group>
            ))}
            {!apiKeysQuery.isPending && keys.length === 0 && <Text size="sm" c="dimmed" className="settings-empty-row">No collector keys yet.</Text>}
          </Stack>
        </Box>

        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Passkeys</Text>
            <Text size="xs" c="dimmed" mt={3}>Name passkeys so you can recognize and remove old devices.</Text>
          </Box>

          {(passkeysQuery.error !== null || registerMutation.error !== null || removePasskeyMutation.error !== null) && (
            <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>
              {errorMessage(passkeysQuery.error ?? registerMutation.error ?? removePasskeyMutation.error, "Passkeys could not be updated")}
            </Alert>
          )}

          <Group align="flex-end" wrap="nowrap" className="settings-create-row">
            <TextInput
              label="Passkey name"
              value={passkeyName}
              onChange={(event) => setPasskeyName(event.currentTarget.value)}
              placeholder="MacBook Touch ID"
              flex={1}
              maxLength={80}
            />
            <Button
              variant="light"
              loading={registerMutation.isPending}
              disabled={passkeyName.trim().length === 0}
              onClick={addPasskey}
              leftSection={<ShieldCheckIcon />}
            >Add passkey</Button>
          </Group>

          <Stack gap={0} className="settings-list">
            {passkeysQuery.isPending && <Center mih={72}><Loader type="dots" /></Center>}
            {passkeys.map((passkey) => (
              <Group key={passkey.id} justify="space-between" wrap="nowrap" className="settings-list-row">
                <Box miw={0}>
                  <Text size="sm" fw={600} className="settings-resource-name">{passkey.name}</Text>
                  <Text size="xs" c="dimmed" className="settings-resource-meta">
                    {passkey.backedUp ? "Synced" : passkey.deviceType === "multiDevice" ? "Multi-device" : "Device-bound"}
                    {` · added ${new Date(passkey.createdAt).toLocaleDateString()}`}
                    {passkey.lastUsedAt ? ` · last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : " · never used"}
                    {passkeys.length === 1 ? " · only passkey" : ""}
                  </Text>
                </Box>
                {passkeys.length > 1 && (
                  <Button
                    variant="light"
                    color="rust"
                    onClick={() => setPasskeyToRemove(passkey)}
                  >Remove</Button>
                )}
              </Group>
            ))}
          </Stack>
        </Box>

        <Box component="section" className="settings-section">
          <Box className="settings-section-heading">
            <Text fw={700} className="settings-section-title">Session</Text>
          </Box>
          {logoutMutation.error && <Alert mb="md" color="rust" icon={<WarningCircleIcon />}>{errorMessage(logoutMutation.error, "Could not sign out")}</Alert>}
          <Group justify="space-between" wrap="nowrap" className="settings-session-row">
            <Text size="sm">This browser</Text>
            <Button variant="default" loading={logoutMutation.isPending} onClick={() => logoutMutation.mutate()} leftSection={<SignOutIcon />}>Sign out</Button>
          </Group>
        </Box>
      </Stack>

      <Modal
        opened={apiKeyToRevoke !== undefined}
        onClose={() => setApiKeyToRevoke(undefined)}
        title="Revoke collector key?"
        closeButtonProps={{ "aria-label": "Close collector key revocation" }}
        centered
        returnFocus
      >
        <Stack gap="md">
          <Text size="sm">{apiKeyToRevoke ? apiKeyRevocationMessage(apiKeyToRevoke.name) : "Ingestion from this collector will stop."}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setApiKeyToRevoke(undefined)}>Cancel</Button>
            <Button color="rust" loading={revokeMutation.isPending} onClick={confirmApiKeyRevocation}>Revoke key</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={passkeyToRemove !== undefined}
        onClose={() => setPasskeyToRemove(undefined)}
        title="Remove passkey?"
        closeButtonProps={{ "aria-label": "Close passkey removal" }}
        centered
        returnFocus
      >
        <Stack gap="md">
          <Text size="sm">{passkeyToRemove ? `“${passkeyToRemove.name}” will no longer be able to sign in to Koliko.` : "This passkey will no longer be able to sign in to Koliko."}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPasskeyToRemove(undefined)}>Cancel</Button>
            <Button color="rust" loading={removePasskeyMutation.isPending} onClick={confirmPasskeyRemoval}>Remove passkey</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
