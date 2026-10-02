'use client'

import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { GitCompareArrows, Play, Rocket, Trash2, TriangleAlert } from 'lucide-react'
import {
  useDiscardInventoryMutation,
  usePublishInventoryMutation,
  useRetryBatchMutation,
  useSubmitInventoryMutation,
  useWorkspaceQuery,
} from '@/lib/hooks'
import {
  batchStatusLabels,
  requestTypeLabels,
  systemChangeKindLabels,
  systemStatusLabels,
  type DataSystem,
  type InventoryVersion,
  type ReconciliationBatch,
  type RequestType,
  type SystemChange,
} from '@/lib/schemas'
import { computeSystemDiff, getEffectiveVersion } from '@/services/reconciliation'

const ALL_TYPES = Object.keys(requestTypeLabels) as RequestType[]

const PRESETS: { key: string; label: string; detail: string; apply: (systems: DataSystem[]) => DataSystem[] }[] = [
  {
    key: 'order-rectification',
    label: '预设①订单平台支持更正',
    detail: '为 DSR-2026-003 补生成订单平台定位/执行任务',
    apply: (systems) =>
      systems.map((system) =>
        system.id === 'sys-order'
          ? {
              ...system,
              requestTypes: [...new Set([...system.requestTypes, 'rectification'])] as DataSystem['requestTypes'],
            }
          : system,
      ),
  },
  {
    key: 'marketing-retire',
    label: '预设②营销平台退役',
    detail: '未完成的营销任务转阻断，已完成任务与回执保留',
    apply: (systems) =>
      systems.map((system) => (system.id === 'sys-marketing' ? { ...system, status: 'retired' } : system)),
  },
  {
    key: 'add-system',
    label: '预设③新增数据仓库',
    detail: '新增一个在用系统（需在请求中关联才会生成任务）',
    apply: (systems) => [
      ...systems,
      {
        id: 'sys-warehouse',
        name: '数据仓库与分析平台',
        owner: '数据平台组',
        dataDomain: '分析宽表、标签快照、留存记录',
        transferMethod: '隔离区批量导出',
        slaDays: 9,
        requestTypes: ['access', 'deletion'],
        status: 'active',
      },
    ],
  },
]

const versionBadgeColor: Record<InventoryVersion['status'], string> = {
  published: 'green',
  pending: 'orange',
  draft: 'red',
  superseded: 'gray',
  rejected: 'gray',
}

function changeBadgeColor(kind: SystemChange['kind']) {
  return kind === 'added' ? 'green' : kind === 'removed' ? 'red' : 'orange'
}

function DiffView({ diff }: { diff: SystemChange[] }) {
  if (!diff.length) return <Text color="gray.500" fontSize="sm">与基线无差异。</Text>
  return (
    <VStack align="stretch" spacing="1">
      {diff.map((change) => (
        <HStack key={`${change.kind}-${change.systemId}`} spacing="2" align="flex-start">
          <Badge colorScheme={changeBadgeColor(change.kind)} flexShrink={0}>
            {systemChangeKindLabels[change.kind]}
          </Badge>
          <Text fontSize="sm">
            {change.systemName}
            {change.fields.length ? `（${change.fields.join('、')}）` : ''}
          </Text>
        </HStack>
      ))}
    </VStack>
  )
}

function SystemEditor({
  rows,
  onChange,
}: {
  rows: DataSystem[]
  onChange: (rows: DataSystem[]) => void
}) {
  function update(id: string, patch: Partial<DataSystem>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  function toggleType(id: string, type: RequestType, checked: boolean) {
    const row = rows.find((item) => item.id === id)
    if (!row) return
    const requestTypes = checked
      ? [...new Set([...row.requestTypes, type])]
      : row.requestTypes.filter((item) => item !== type)
    update(id, { requestTypes })
  }
  function remove(id: string) {
    onChange(rows.filter((row) => row.id !== id))
  }
  function addRow() {
    const nextIndex = rows.length + 1
    onChange([
      ...rows,
      {
        id: `sys-new-${Date.now()}`,
        name: '新系统',
        owner: '责任团队',
        dataDomain: '数据域说明',
        transferMethod: '受控接口导出',
        slaDays: 7,
        requestTypes: ['access'],
        status: 'active',
      },
    ])
    void nextIndex
  }

  return (
    <Box>
      <HStack mb="2">
        <Button size="xs" colorScheme="brand" onClick={addRow}>
          新增系统行
        </Button>
        <Text color="gray.500" fontSize="xs">
          删除行表示系统退役/移出清单；直接改字段表示映射变更。
        </Text>
      </HStack>
      <TableContainer maxH="340px" overflowY="auto" borderWidth="1px" borderRadius="5px">
        <Table size="xs">
          <Thead position="sticky" top="0" bg="gray.50">
            <Tr>
              <Th>系统名称 / 团队</Th>
              <Th width="230px">支持类型</Th>
              <Th width="110px">状态</Th>
              <Th width="80px">SLA</Th>
              <Th width="50px"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td>
                  <Input
                    size="xs"
                    value={row.name}
                    mb="1"
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                  <Input
                    size="xs"
                    value={row.owner}
                    onChange={(event) => update(row.id, { owner: event.target.value })}
                  />
                </Td>
                <Td>
                  <HStack wrap="wrap" spacing="2">
                    {ALL_TYPES.map((type) => (
                      <Checkbox
                        key={type}
                        size="sm"
                        isChecked={row.requestTypes.includes(type)}
                        onChange={(event) => toggleType(row.id, type, event.target.checked)}
                      >
                        {requestTypeLabels[type]}
                      </Checkbox>
                    ))}
                  </HStack>
                </Td>
                <Td>
                  <Select
                    size="xs"
                    value={row.status}
                    onChange={(event) =>
                      update(row.id, { status: event.target.value as DataSystem['status'] })
                    }
                  >
                    {Object.entries(systemStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Input
                    size="xs"
                    type="number"
                    value={row.slaDays}
                    onChange={(event) => update(row.id, { slaDays: Number(event.target.value) })}
                  />
                </Td>
                <Td>
                  <IconButton
                    aria-label="移除系统"
                    size="xs"
                    variant="ghost"
                    colorScheme="red"
                    icon={<Trash2 size={14} />}
                    onClick={() => remove(row.id)}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>
    </Box>
  )
}

function BatchProgress({ batch }: { batch: ReconciliationBatch }) {
  const done = batch.items.filter((item) => item.status !== 'pending').length
  const percent = batch.items.length ? Math.round((done / batch.items.length) * 100) : 100
  return (
    <Box p="3" borderWidth="1px" borderRadius="5px" bg={batch.status === 'failed' ? 'red.50' : 'gray.50'}>
      <Flex justify="space-between" align="center" mb="2">
        <HStack>
          <Badge colorScheme={batch.status === 'completed' ? 'green' : batch.status === 'failed' ? 'red' : 'blue'}>
            {batchStatusLabels[batch.status]}
          </Badge>
          <Text fontWeight="600" fontSize="sm">
            {batch.id}
          </Text>
        </HStack>
        <Text fontSize="xs" color="gray.600">
          检查点 {done}/{batch.items.length}（{percent}%）
        </Text>
      </Flex>
      <Box h="6px" bg="gray.200" borderRadius="3px" mb="2" overflow="hidden">
        <Box
          h="100%"
          bg={batch.status === 'failed' ? '#c74d4d' : batch.status === 'completed' ? '#38a169' : '#3182ce'}
          width={`${percent}%`}
        />
      </Box>
      <VStack align="stretch" spacing="1">
        {batch.items.map((item) => (
          <HStack key={item.requestId} fontSize="xs" align="flex-start">
            <Badge
              flexShrink={0}
              colorScheme={
                item.status === 'done' ? 'green' : item.status === 'skipped' ? 'gray' : 'orange'
              }
            >
              {item.status === 'done' ? '已对账' : item.status === 'skipped' ? '保留历史' : '待处理'}
            </Badge>
            <Text color={item.status === 'pending' ? 'gray.500' : 'gray.700'}>
              {item.requestCode}
              {item.detail ? `：${item.detail}` : ''}
            </Text>
          </HStack>
        ))}
      </VStack>
      {batch.failureReason ? (
        <Alert status="error" mt="2" fontSize="xs" py="1">
          {batch.failureReason}
        </Alert>
      ) : null}
    </Box>
  )
}

export function VersionCenter() {
  const { data } = useWorkspaceQuery()
  const toast = useToast()
  const submit = useSubmitInventoryMutation()
  const publish = usePublishInventoryMutation()
  const retry = useRetryBatchMutation()
  const discard = useDiscardInventoryMutation()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const effective = data ? getEffectiveVersion(data) : undefined
  const pending = useMemo(
    () =>
      data?.inventoryVersions
        .filter((version) => version.status === 'pending')
        .sort((left, right) => right.versionNo - left.versionNo) ?? [],
    [data],
  )
  const drafts = useMemo(
    () =>
      data?.inventoryVersions
        .filter((version) => version.status === 'draft')
        .sort((left, right) => right.versionNo - left.versionNo) ?? [],
    [data],
  )
  const batches = useMemo(
    () =>
      [...(data?.reconciliationBatches ?? [])].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [data],
  )
  const history = useMemo(
    () =>
      [...(data?.inventoryVersions ?? [])]
        .filter((version) => ['published', 'superseded', 'rejected'].includes(version.status))
        .sort((left, right) => right.versionNo - left.versionNo),
    [data],
  )

  const [rows, setRows] = useState<DataSystem[]>([])
  const [operator, setOperator] = useState('管理员甲')
  const [changeSummary, setChangeSummary] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(true)
  const [busyVersionId, setBusyVersionId] = useState('')

  const editorDiff = useMemo(
    () => (effective && rows.length ? computeSystemDiff(effective.systems, rows) : []),
    [effective, rows],
  )

  if (!data || !effective) return <Box className="panel">正在加载清单版本...</Box>

  function openSubmit(presetKey?: string) {
    const preset = PRESETS.find((item) => item.key === presetKey)
    const base = effective ? effective.systems.map((system) => ({ ...system })) : []
    setRows(preset ? preset.apply(base) : base)
    setChangeSummary(preset ? `${preset.label}：${preset.detail}` : '')
    setSimulateFailure(true)
    onOpen()
  }

  async function handleSubmit() {
    try {
      const result = await submit.mutateAsync({
        baseVersionId: effective!.id,
        changeSummary: changeSummary.trim(),
        systems: rows,
        operator,
      })
      toast({ title: result.outcome === 'draft' ? '已保留为冲突草稿' : '变更已提交', description: result.message, status: result.outcome === 'draft' ? 'warning' : 'success' })
      if (result.outcome !== 'draft') onClose()
    } catch (error) {
      toast({ title: '提交失败', description: error instanceof Error ? error.message : '请检查清单', status: 'error' })
    }
  }

  async function handlePublish(version: InventoryVersion, failure: boolean) {
    setBusyVersionId(version.id)
    try {
      const result = await publish.mutateAsync({
        versionId: version.id,
        operator,
        simulateFailure: failure,
      })
      if (result.outcome === 'failed') {
        toast({ title: '发布中断，已保留检查点', description: result.message, status: 'warning' })
      } else {
        toast({ title: '版本已发布', description: result.message, status: 'success' })
      }
    } catch (error) {
      toast({ title: '发布失败', description: error instanceof Error ? error.message : '请重试', status: 'error' })
    } finally {
      setBusyVersionId('')
    }
  }

  async function handleRetry(batch: ReconciliationBatch, failure: boolean) {
    setBusyVersionId(batch.id)
    try {
      const result = await retry.mutateAsync({
        batchId: batch.id,
        operator,
        simulateFailure: failure,
      })
      toast({
        title: result.outcome === 'failed' ? '续跑再次中断' : '批次已补完',
        description: result.message,
        status: result.outcome === 'failed' ? 'warning' : 'success',
      })
    } catch (error) {
      toast({ title: '续跑失败', description: error instanceof Error ? error.message : '请重试', status: 'error' })
    } finally {
      setBusyVersionId('')
    }
  }

  async function handleDiscard(version: InventoryVersion) {
    try {
      await discard.mutateAsync({ versionId: version.id, operator })
      toast({ title: '版本已放弃', status: 'success' })
    } catch (error) {
      toast({ title: '操作失败', description: error instanceof Error ? error.message : '请重试', status: 'error' })
    }
  }

  const affectedBatchOf = (versionId: string) =>
    data.reconciliationBatches.find((batch) => batch.versionId === versionId)

  return (
    <VStack align="stretch" spacing="4">
      <Box className="panel">
        <Flex className="panel-title">
          <HStack>
            <Rocket size={17} color="#237b78" />
            <Heading size="sm">当前有效清单版本</Heading>
            <Badge colorScheme="green" fontSize="sm">
              v{effective.versionNo} · {effective.id}
            </Badge>
          </HStack>
          <Select width="160px" size="sm" value={operator} onChange={(event) => setOperator(event.target.value)}>
            <option value="管理员甲">以 管理员甲 操作</option>
            <option value="管理员乙">以 管理员乙 操作</option>
          </Select>
        </Flex>
        <HStack wrap="wrap" spacing="3">
          <Button size="sm" colorScheme="brand" leftIcon={<GitCompareArrows size={15} />} onClick={() => openSubmit()}>
            提交清单变更
          </Button>
          {PRESETS.map((preset) => (
            <Button key={preset.key} size="sm" variant="outline" onClick={() => openSubmit(preset.key)}>
              {preset.label}
            </Button>
          ))}
        </HStack>
        <Text mt="2" color="gray.600" fontSize="xs">
          发布人：{effective.publishedBy ?? '-'} · 发布时间：
          {effective.publishedAt ? new Date(effective.publishedAt).toLocaleString('zh-CN') : '-'} ·{' '}
          {effective.changeSummary}
        </Text>
        <Alert status="info" mt="3" fontSize="sm">
          提交先进待生效版本；发布时冻结受影响请求的证据并补算缺失任务，已完成任务和原始回执保持可查。勾选“模拟发布中断”可验证检查点续跑。
        </Alert>
      </Box>

      {pending.length ? (
        <Box className="panel">
          <Flex className="panel-title">
            <HStack>
              <Heading size="sm">待生效版本</Heading>
              <Badge colorScheme="orange">{pending.length}</Badge>
            </HStack>
          </Flex>
          <VStack align="stretch" spacing="3">
            {pending.map((version) => {
              const batch = affectedBatchOf(version.id)
              return (
                <Box key={version.id} p="3" borderWidth="1px" borderRadius="5px">
                  <Flex justify="space-between" align="center">
                    <HStack>
                      <Badge colorScheme="orange">待生效 v{version.versionNo}</Badge>
                      <Text fontWeight="600">{version.changeSummary}</Text>
                    </HStack>
                    <HStack>
                      <Checkbox
                        size="sm"
                        isChecked={simulateFailure}
                        onChange={(event) => setSimulateFailure(event.target.checked)}
                      >
                        模拟发布中断
                      </Checkbox>
                      {batch?.status === 'failed' ? (
                        <Button
                          size="xs"
                          colorScheme="orange"
                          leftIcon={<Play size={13} />}
                          isLoading={busyVersionId === batch.id}
                          onClick={() => handleRetry(batch, false)}
                        >
                          从检查点续跑（{batch.nextIndex}/{batch.items.length}）
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          colorScheme="brand"
                          isLoading={busyVersionId === version.id}
                          onClick={() => handlePublish(version, simulateFailure)}
                        >
                          {batch?.status === 'processing' ? '继续发布' : '发布并重算'}
                        </Button>
                      )}
                      <Button size="xs" variant="ghost" colorScheme="red" onClick={() => handleDiscard(version)}>
                        放弃
                      </Button>
                    </HStack>
                  </Flex>
                  <Text mt="1" color="gray.500" fontSize="xs">
                    {version.submittedBy} 提交于 {new Date(version.submittedAt).toLocaleString('zh-CN')} · 基于 {version.baseVersionId}
                  </Text>
                  <Box mt="2">
                    <DiffView diff={version.diff} />
                  </Box>
                  {batch ? <Box mt="3"><BatchProgress batch={batch} /></Box> : null}
                </Box>
              )
            })}
          </VStack>
        </Box>
      ) : null}

      {drafts.length ? (
        <Box className="panel" borderColor="red.200">
          <Flex className="panel-title">
            <HStack>
              <TriangleAlert size={16} color="#c74d4d" />
              <Heading size="sm">并发冲突草稿（同一基线只放行一位）</Heading>
              <Badge colorScheme="red">{drafts.length}</Badge>
            </HStack>
          </Flex>
          <VStack align="stretch" spacing="3">
            {drafts.map((version) => {
              const winner = data.inventoryVersions.find((item) => item.id === version.conflictWithVersionId)
              return (
                <Box key={version.id} p="3" borderWidth="1px" borderColor="red.200" borderRadius="5px" bg="red.50">
                  <Flex justify="space-between" align="center">
                    <HStack>
                      <Badge colorScheme="red">草稿 v{version.versionNo}</Badge>
                      <Text fontWeight="600">{version.changeSummary}</Text>
                    </HStack>
                    <HStack>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setRows(version.systems.map((system) => ({ ...system })))
                          setChangeSummary(version.changeSummary)
                          onOpen()
                        }}
                      >
                        基于草稿编辑
                      </Button>
                      <Button size="xs" variant="ghost" colorScheme="red" onClick={() => handleDiscard(version)}>
                        放弃草稿
                      </Button>
                    </HStack>
                  </Flex>
                  <Text mt="1" fontSize="sm" color="red.700">
                    {version.conflictNote}
                  </Text>
                  <Text mt="1" color="gray.500" fontSize="xs">
                    {version.submittedBy} 提交于 {new Date(version.submittedAt).toLocaleString('zh-CN')}
                  </Text>
                  <Box mt="2">
                    <Text fontWeight="600" fontSize="xs" mb="1">
                      草稿相对当前有效版本的差异（供后到者合并参考）：
                    </Text>
                    <DiffView diff={version.diff} />
                  </Box>
                  {winner && winner.status === 'published' ? (
                    <Alert status="warning" mt="2" fontSize="xs" py="1">
                      抢先版本 {winner.id} 已发布，请基于最新有效版本重新提交差异。
                    </Alert>
                  ) : null}
                </Box>
              )
            })}
          </VStack>
        </Box>
      ) : null}

      {batches.length ? (
        <Box className="panel">
          <Flex className="panel-title">
            <Heading size="sm">对账批次与检查点</Heading>
            <Badge colorScheme="blue">{batches.length}</Badge>
          </Flex>
          <VStack align="stretch" spacing="3">
            {batches.map((batch) => (
              <Flex key={batch.id} gap="3" align="stretch">
                <Box flex="1">
                  <BatchProgress batch={batch} />
                </Box>
                {batch.status === 'failed' ? (
                  <VStack justify="center" spacing="2">
                    <Button
                      size="sm"
                      colorScheme="orange"
                      leftIcon={<Play size={14} />}
                      isLoading={busyVersionId === batch.id}
                      onClick={() => handleRetry(batch, false)}
                    >
                      重试：只补未完成项
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => handleRetry(batch, true)}>
                      再次模拟中断
                    </Button>
                  </VStack>
                ) : null}
              </Flex>
            ))}
          </VStack>
        </Box>
      ) : null}

      <Box className="panel">
        <Flex className="panel-title">
          <Heading size="sm">版本历史</Heading>
        </Flex>
        <TableContainer>
          <Table size="sm">
            <Thead>
              <Tr>
                <Th>版本</Th>
                <Th>状态</Th>
                <Th>变更说明</Th>
                <Th>提交人</Th>
                <Th>发布时间</Th>
                <Th>差异</Th>
              </Tr>
            </Thead>
            <Tbody>
              {history.map((version) => (
                <Tr key={version.id}>
                  <Td fontWeight="600">v{version.versionNo}</Td>
                  <Td>
                    <Badge colorScheme={versionBadgeColor[version.status]}>
                      {version.status === 'published' ? '有效版本' : version.status === 'superseded' ? '已替代' : '已放弃'}
                    </Badge>
                  </Td>
                  <Td>{version.changeSummary}</Td>
                  <Td>{version.submittedBy}</Td>
                  <Td>{version.publishedAt ? new Date(version.publishedAt).toLocaleString('zh-CN') : '-'}</Td>
                  <Td maxW="320px">
                    <DiffView diff={version.diff} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

      <Modal isOpen={isOpen} onClose={onClose} size="5xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>提交系统清单变更（进入待生效版本）</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing="4">
              <Flex gap="4">
                <FormControl width="220px">
                  <FormLabel>提交管理员</FormLabel>
                  <Select value={operator} onChange={(event) => setOperator(event.target.value)}>
                    <option value="管理员甲">管理员甲</option>
                    <option value="管理员乙">管理员乙</option>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>变更说明</FormLabel>
                  <Input
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                    placeholder="例如：订单平台扩展更正支持，营销平台转入退役"
                  />
                </FormControl>
              </Flex>
              <SystemEditor rows={rows} onChange={setRows} />
              <Box>
                <Text fontWeight="600" fontSize="sm" mb="1">
                  相对 {effective.id} 的差异预览（{editorDiff.length} 项）
                </Text>
                <DiffView diff={editorDiff} />
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={onClose}>
              取消
            </Button>
            <Button
              colorScheme="brand"
              isLoading={submit.isPending}
              isDisabled={!changeSummary.trim() || !editorDiff.length}
              onClick={handleSubmit}
            >
              提交为待生效版本
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  )
}
