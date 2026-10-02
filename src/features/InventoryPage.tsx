'use client'

import { useEffect, useMemo, useState } from 'react'
import NextLink from 'next/link'
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Select,
  SimpleGrid,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { GitBranch, GitCommitHorizontal, Play, RotateCcw, UploadCloud } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import {
  useDiscardInventoryDraftMutation,
  usePublishInventoryMutation,
  useRebaseInventoryDraftMutation,
  useResumePublishBatchMutation,
  useSaveInventoryDraftMutation,
  useSubmitInventoryDraftMutation,
  useWithdrawInventoryVersionMutation,
  useWorkspaceQuery,
} from '@/lib/hooks'
import {
  inventoryVersionStatusLabels,
  publishBatchStatusLabels,
  requestTypeLabels,
  systemStatusLabels,
  type DataSystem,
  type RequestType,
} from '@/lib/schemas'
import {
  affectedRequestCount,
  diffSummaryLines,
  diffSystems,
  effectiveVersion,
  isEmptyDiff,
  pendingVersion,
} from '@/services/inventoryService'

const ADMIN_OPTIONS = ['隐私运营', '平台管理员', '数据治理负责人']
const ALL_TYPES = Object.keys(requestTypeLabels) as RequestType[]

const batchStatusColor = { running: 'blue', failed: 'red', completed: 'green' } as const
const versionStatusColor = { pending: 'orange', effective: 'green', superseded: 'gray' } as const

export function InventoryPage() {
  const { data, isLoading } = useWorkspaceQuery()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [admin, setAdmin] = useState(ADMIN_OPTIONS[0])
  const [systems, setSystems] = useState<DataSystem[]>([])
  const [note, setNote] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [newSystem, setNewSystem] = useState({
    name: '',
    owner: '',
    dataDomain: '',
    transferMethod: '受控接口导出',
    slaDays: 5,
    status: 'active' as DataSystem['status'],
    requestTypes: ['access'] as RequestType[],
  })

  const saveDraft = useSaveInventoryDraftMutation()
  const submitDraft = useSubmitInventoryDraftMutation()
  const rebaseDraft = useRebaseInventoryDraftMutation()
  const discardDraft = useDiscardInventoryDraftMutation()
  const withdrawVersion = useWithdrawInventoryVersionMutation()
  const publishInventory = usePublishInventoryMutation()
  const resumeBatch = useResumePublishBatchMutation()

  const myDraft = data?.inventory.drafts.find((entry) => entry.updatedBy === admin)

  useEffect(() => {
    if (!data) return
    const source = data.inventory.drafts.find((entry) => entry.updatedBy === admin)
    setSystems(structuredClone(source?.systems ?? effectiveVersion(data).systems))
    setNote(source?.note ?? '')
  }, [data, admin])

  const dirty = useMemo(() => {
    if (!data) return false
    if (!myDraft) return true
    return JSON.stringify(systems) !== JSON.stringify(myDraft.systems) || note !== myDraft.note
  }, [data, myDraft, systems, note])

  if (isLoading || !data) return <Box className="panel">正在加载清单版本工作区...</Box>

  const effective = effectiveVersion(data)
  const pending = pendingVersion(data)
  const latestBatch = data.publishBatches[0]
  const draftDiff = diffSystems(effective.systems, systems)
  const draftDiffLines = diffSummaryLines(draftDiff)
  const draftAffected = affectedRequestCount(data, systems)
  const pendingDiff = pending ? diffSystems(effective.systems, pending.systems) : null
  const pendingAffected = pending ? affectedRequestCount(data, pending.systems) : 0

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action()
      toast({ title: success, status: 'success' })
    } catch (error) {
      toast({
        title: '操作未完成',
        description: error instanceof Error ? error.message : '请检查输入',
        status: 'error',
      })
    }
  }

  function patchSystem(id: string, patch: Partial<DataSystem>) {
    setSystems((current) =>
      current.map((system) => (system.id === id ? { ...system, ...patch } : system)),
    )
  }

  async function handleSubmitDraft() {
    if (!myDraft) return
    try {
      const next = await submitDraft.mutateAsync({ draftId: myDraft.id, operator: admin })
      const stillDraft = next.inventory.drafts.find((entry) => entry.updatedBy === admin)
      if (stillDraft?.status === 'conflicted') {
        toast({
          title: '提交未放行',
          description: '同一清单版本已有其他管理员提交，草稿已保留，可查看差异。',
          status: 'warning',
        })
      } else {
        toast({ title: '已提交为待生效版本', status: 'success' })
      }
    } catch (error) {
      toast({
        title: '提交未完成',
        description: error instanceof Error ? error.message : '请检查草稿内容',
        status: 'error',
      })
    }
  }

  async function handlePublish() {
    try {
      const next = await publishInventory.mutateAsync({
        operator: admin,
        simulateFailureAfter: simulateFailure ? 2 : undefined,
      })
      const batch = next.publishBatches[0]
      if (batch?.status === 'failed') {
        toast({
          title: '发布批次中断',
          description: batch.error,
          status: 'error',
        })
      } else {
        toast({ title: '清单版本已发布生效，受影响请求完成重算', status: 'success' })
      }
    } catch (error) {
      toast({
        title: '发布未完成',
        description: error instanceof Error ? error.message : '请检查版本状态',
        status: 'error',
      })
    }
  }

  async function handleResume() {
    if (!latestBatch) return
    try {
      const next = await resumeBatch.mutateAsync({
        batchId: latestBatch.id,
        operator: admin,
        simulateFailureAfter: simulateFailure ? 2 : undefined,
      })
      const batch = next.publishBatches.find((entry) => entry.id === latestBatch.id)
      if (batch?.status === 'failed') {
        toast({ title: '批次再次中断', description: batch.error, status: 'error' })
      } else {
        toast({ title: '批次续跑完成，版本已生效', status: 'success' })
      }
    } catch (error) {
      toast({
        title: '重试未完成',
        description: error instanceof Error ? error.message : '请检查批次状态',
        status: 'error',
      })
    }
  }

  return (
    <Box>
      <PageHeader
        title="清单版本与发布重算"
        description="清单变更先进入待生效版本，发布时冻结受影响请求证据、重算缺失任务；批次中断保留检查点，重试只补未完成项。"
        actions={
          <>
            <NextLink href="/systems">
              <Button variant="outline">查看系统清单</Button>
            </NextLink>
            <Badge colorScheme="green" alignSelf="center" px="3" py="1">
              有效版本 v{effective.version}
            </Badge>
          </>
        }
      />

      <SimpleGrid columns={4} spacing="4" mb="5">
        <Box className="metric">
          <Text color="gray.600" fontSize="sm">有效版本</Text>
          <Heading mt="2" size="md">v{effective.version}</Heading>
          <Text mt="1" color="gray.500" fontSize="xs">
            {effective.publishedAt ? new Date(effective.publishedAt).toLocaleString('zh-CN') : '未发布'} 生效
          </Text>
        </Box>
        <Box className={`metric ${pending ? 'warning' : ''}`}>
          <Text color="gray.600" fontSize="sm">待生效版本</Text>
          <Heading mt="2" size="md">{pending ? `v${pending.version}` : '无'}</Heading>
          <Text mt="1" color="gray.500" fontSize="xs">
            {pending ? `${pending.createdBy} 提交，将影响 ${pendingAffected} 个进行中请求` : '提交草稿后进入待生效'}
          </Text>
        </Box>
        <Box className={`metric ${data.inventory.drafts.length ? 'info' : ''}`}>
          <Text color="gray.600" fontSize="sm">编辑中草稿</Text>
          <Heading mt="2" size="md">{data.inventory.drafts.length}</Heading>
          <Text mt="1" color="gray.500" fontSize="xs">按管理员分别保留，互不影响</Text>
        </Box>
        <Box className={`metric ${latestBatch?.status === 'failed' ? 'danger' : ''}`}>
          <Text color="gray.600" fontSize="sm">最近发布批次</Text>
          <Heading mt="2" size="md">
            {latestBatch ? publishBatchStatusLabels[latestBatch.status] : '暂无'}
          </Heading>
          <Text mt="1" color="gray.500" fontSize="xs">
            {latestBatch ? `检查点 ${latestBatch.checkpoint}/${latestBatch.items.length}` : '发布版本时生成对账批次'}
          </Text>
        </Box>
      </SimpleGrid>

      {latestBatch?.status === 'failed' ? (
        <Alert status="error" mb="4" borderRadius="5px">
          <AlertIcon />
          <Box flex="1">
            <Text fontWeight="600">发布批次中断，检查点已保留</Text>
            <Text fontSize="sm">{latestBatch.error}</Text>
          </Box>
          <Button size="sm" colorScheme="red" onClick={handleResume} isLoading={resumeBatch.isPending}>
            从检查点重试
          </Button>
        </Alert>
      ) : null}

      {pending && pendingDiff ? (
        <Box className="panel" borderLeft="4px solid #d18a28">
          <Flex className="panel-title">
            <HStack>
              <GitCommitHorizontal size={18} color="#d18a28" />
              <Heading size="sm">待生效版本 v{pending.version}</Heading>
              <Badge colorScheme="orange">待发布</Badge>
            </HStack>
            <HStack>
              <Checkbox
                isChecked={simulateFailure}
                onChange={(event) => setSimulateFailure(event.target.checked)}
              >
                模拟批次中断
              </Checkbox>
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(() => withdrawVersion.mutateAsync({ operator: admin }), '待生效版本已撤回为草稿')}
                isLoading={withdrawVersion.isPending}
              >
                撤回为草稿
              </Button>
              <Button
                size="sm"
                colorScheme="brand"
                leftIcon={<UploadCloud size={15} />}
                onClick={handlePublish}
                isLoading={publishInventory.isPending}
                isDisabled={latestBatch?.status === 'failed'}
              >
                发布并重算
              </Button>
            </HStack>
          </Flex>
          <Text color="gray.600" fontSize="sm" mb="3">
            {pending.createdBy} 提交于 {new Date(pending.createdAt).toLocaleString('zh-CN')}
            {pending.note ? ` · ${pending.note}` : ''}。发布将冻结受影响请求的证据、补建缺失任务，
            预计重算 {pendingAffected} 个进行中请求；已完成任务与原始回执保留可查。
          </Text>
          <VStack align="stretch" spacing="1">
            {diffSummaryLines(pendingDiff).map((line) => (
              <Text key={line} fontSize="sm">· {line}</Text>
            ))}
          </VStack>
        </Box>
      ) : null}

      {latestBatch ? (
        <Box className="panel">
          <Flex className="panel-title">
            <HStack>
              <Play size={16} color="#3e73a4" />
              <Heading size="sm">发布批次 v{latestBatch.version}</Heading>
              <Badge colorScheme={batchStatusColor[latestBatch.status]}>
                {publishBatchStatusLabels[latestBatch.status]}
              </Badge>
            </HStack>
            <Text color="gray.500" fontSize="sm">
              检查点 {latestBatch.checkpoint}/{latestBatch.items.length} · 开始于{' '}
              {new Date(latestBatch.startedAt).toLocaleString('zh-CN')}
            </Text>
          </Flex>
          <Progress
            mb="3"
            size="sm"
            value={(latestBatch.checkpoint / Math.max(1, latestBatch.items.length)) * 100}
            colorScheme={latestBatch.status === 'failed' ? 'red' : 'brand'}
          />
          {latestBatch.error ? (
            <Alert status="warning" mb="3" borderRadius="5px" fontSize="sm">
              {latestBatch.error}
            </Alert>
          ) : null}
          <TableContainer>
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>请求编号</Th>
                  <Th>处理状态</Th>
                  <Th>重算动作</Th>
                </Tr>
              </Thead>
              <Tbody>
                {latestBatch.items.map((item) => (
                  <Tr key={item.requestId}>
                    <Td className="mono">{item.code}</Td>
                    <Td>
                      <Badge
                        colorScheme={
                          item.status === 'done' ? 'green' : item.status === 'skipped' ? 'gray' : 'orange'
                        }
                      >
                        {item.status === 'done' ? '已重算' : item.status === 'skipped' ? '无需变更' : '待处理'}
                      </Badge>
                    </Td>
                    <Td whiteSpace="normal">{item.actions.join('；') || '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Box>
      ) : null}

      <Box className="panel">
        <Flex className="panel-title">
          <HStack>
            <GitBranch size={16} color="#237b78" />
            <Heading size="sm">清单草稿</Heading>
            {myDraft ? (
              <Badge colorScheme={myDraft.status === 'conflicted' ? 'red' : 'blue'}>
                {myDraft.status === 'conflicted' ? '提交未放行' : '编辑中'}
              </Badge>
            ) : (
              <Badge>未创建</Badge>
            )}
          </HStack>
          <HStack>
            <Text color="gray.500" fontSize="sm">操作管理员</Text>
            <Select width="180px" size="sm" value={admin} onChange={(event) => setAdmin(event.target.value)}>
              {ADMIN_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
          </HStack>
        </Flex>

        {myDraft?.status === 'conflicted' && myDraft.conflictSummary ? (
          <Alert status="error" mb="4" borderRadius="5px" alignItems="flex-start">
            <AlertIcon mt="1" />
            <Box flex="1">
              <Text fontWeight="600" mb="1">同一清单版本已有其他管理员提交，本次未放行，草稿已保留：</Text>
              {myDraft.conflictSummary.map((line) => (
                <Text key={line} fontSize="sm">· {line}</Text>
              ))}
              <HStack mt="3">
                <Button
                  size="xs"
                  colorScheme="red"
                  variant="outline"
                  onClick={() =>
                    run(
                      () => rebaseDraft.mutateAsync({ draftId: myDraft.id, operator: admin }),
                      '已以有效版本为基准重建草稿',
                    )
                  }
                >
                  以有效版本重建草稿
                </Button>
                <Text color="gray.500" fontSize="xs">重建会覆盖当前编辑内容；也可以继续编辑后重新提交。</Text>
              </HStack>
            </Box>
          </Alert>
        ) : null}

        <TableContainer mb="3">
          <Table size="sm">
            <Thead>
              <Tr>
                <Th>系统名称</Th>
                <Th>责任团队</Th>
                <Th>状态</Th>
                <Th>SLA（天）</Th>
                <Th>支持请求类型</Th>
                <Th>操作</Th>
              </Tr>
            </Thead>
            <Tbody>
              {systems.map((system) => (
                <Tr key={system.id}>
                  <Td fontWeight="600">{system.name}</Td>
                  <Td>
                    <Input
                      size="sm"
                      value={system.owner}
                      onChange={(event) => patchSystem(system.id, { owner: event.target.value })}
                    />
                  </Td>
                  <Td>
                    <Select
                      size="sm"
                      value={system.status}
                      onChange={(event) =>
                        patchSystem(system.id, { status: event.target.value as DataSystem['status'] })
                      }
                    >
                      {Object.entries(systemStatusLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Input
                      size="sm"
                      type="number"
                      width="80px"
                      value={system.slaDays}
                      onChange={(event) =>
                        patchSystem(system.id, { slaDays: Number(event.target.value) || 0 })
                      }
                    />
                  </Td>
                  <Td>
                    <HStack wrap="wrap" spacing="2">
                      {ALL_TYPES.map((type) => (
                        <Checkbox
                          key={type}
                          size="sm"
                          isChecked={system.requestTypes.includes(type)}
                          onChange={(event) =>
                            patchSystem(system.id, {
                              requestTypes: event.target.checked
                                ? [...system.requestTypes, type]
                                : system.requestTypes.filter((entry) => entry !== type),
                            })
                          }
                        >
                          {requestTypeLabels[type]}
                        </Checkbox>
                      ))}
                    </HStack>
                  </Td>
                  <Td>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="red"
                      onClick={() =>
                        setSystems((current) => current.filter((entry) => entry.id !== system.id))
                      }
                    >
                      移除
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </TableContainer>

        <HStack mb="3" align="flex-start">
          <Textarea
            placeholder="变更说明（提交与发布时写入审计）"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </HStack>

        {draftDiffLines.length ? (
          <Box className="summary-box" mb="3">
            <Text fontWeight="600" fontSize="sm" mb="1">
              与有效版本 v{effective.version} 的差异（预计影响 {draftAffected} 个进行中请求）
            </Text>
            {draftDiffLines.map((line) => (
              <Text key={line} color="gray.600" fontSize="sm">· {line}</Text>
            ))}
          </Box>
        ) : (
          <Text color="gray.500" fontSize="sm" mb="3">当前编辑与有效版本一致。</Text>
        )}

        <HStack>
          <Button size="sm" variant="outline" onClick={onOpen}>新增系统</Button>
          <Box flex="1" />
          {myDraft ? (
            <Button
              size="sm"
              variant="ghost"
              colorScheme="red"
              onClick={() =>
                run(
                  () => discardDraft.mutateAsync({ draftId: myDraft.id, operator: admin }),
                  '草稿已放弃',
                )
              }
            >
              放弃草稿
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            isDisabled={!dirty || !systems.length}
            isLoading={saveDraft.isPending}
            onClick={() =>
              run(
                () => saveDraft.mutateAsync({ systems, note, operator: admin }),
                '草稿已保存为待生效候选',
              )
            }
          >
            保存草稿
          </Button>
          <Button
            size="sm"
            colorScheme="brand"
            isDisabled={!myDraft || dirty || isEmptyDiff(diffSystems(effective.systems, myDraft.systems))}
            isLoading={submitDraft.isPending}
            onClick={handleSubmitDraft}
          >
            提交为待生效版本
          </Button>
        </HStack>
        {myDraft && dirty ? (
          <Text mt="2" color="orange.600" fontSize="xs">有未保存的修改，请先保存草稿再提交。</Text>
        ) : null}
      </Box>

      <div className="two-column">
        <Box className="panel">
          <Flex className="panel-title">
            <Heading size="sm">版本历史</Heading>
            <Badge>{data.inventory.versions.length} 个版本</Badge>
          </Flex>
          <TableContainer>
            <Table size="sm">
              <Thead>
                <Tr>
                  <Th>版本</Th>
                  <Th>状态</Th>
                  <Th>提交人</Th>
                  <Th>发布时间</Th>
                </Tr>
              </Thead>
              <Tbody>
                {[...data.inventory.versions]
                  .sort((left, right) => right.version - left.version)
                  .map((version) => (
                    <Tr key={version.id}>
                      <Td fontWeight="600">v{version.version}</Td>
                      <Td>
                        <Badge colorScheme={versionStatusColor[version.status]}>
                          {inventoryVersionStatusLabels[version.status]}
                        </Badge>
                      </Td>
                      <Td>{version.createdBy}</Td>
                      <Td>{version.publishedAt ? new Date(version.publishedAt).toLocaleString('zh-CN') : '—'}</Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </TableContainer>
        </Box>

        <Box className="panel">
          <Flex className="panel-title">
            <Heading size="sm">发布批次历史</Heading>
            <Badge>{data.publishBatches.length} 个批次</Badge>
          </Flex>
          <VStack align="stretch" spacing="2">
            {data.publishBatches.slice(0, 6).map((batch) => (
              <Box key={batch.id} className="timeline-item">
                <Flex justify="space-between">
                  <Text fontWeight="600">清单 v{batch.version} 发布批次</Text>
                  <Badge colorScheme={batchStatusColor[batch.status]}>
                    {publishBatchStatusLabels[batch.status]}
                  </Badge>
                </Flex>
                <Text mt="1" color="gray.600" fontSize="sm">
                  检查点 {batch.checkpoint}/{batch.items.length} ·{' '}
                  {new Date(batch.startedAt).toLocaleString('zh-CN')}
                  {batch.finishedAt ? ` · 完成于 ${new Date(batch.finishedAt).toLocaleString('zh-CN')}` : ''}
                </Text>
              </Box>
            ))}
            {!data.publishBatches.length ? (
              <Text color="gray.500" fontSize="sm">暂无发布批次，发布待生效版本后生成。</Text>
            ) : null}
          </VStack>
          <Divider my="4" />
          <Text color="gray.500" fontSize="xs">
            批次按请求逐项重算并写入检查点；中断后重试只补未完成项，已生成的任务与审计不会重复。
          </Text>
        </Box>
      </div>

      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>新增系统到草稿</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="stretch" spacing="4">
              <FormControl isRequired>
                <FormLabel>系统名称</FormLabel>
                <Input
                  value={newSystem.name}
                  onChange={(event) => setNewSystem({ ...newSystem, name: event.target.value })}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>责任团队</FormLabel>
                <Input
                  value={newSystem.owner}
                  onChange={(event) => setNewSystem({ ...newSystem, owner: event.target.value })}
                />
              </FormControl>
              <FormControl>
                <FormLabel>数据域</FormLabel>
                <Input
                  value={newSystem.dataDomain}
                  onChange={(event) => setNewSystem({ ...newSystem, dataDomain: event.target.value })}
                />
              </FormControl>
              <HStack>
                <FormControl>
                  <FormLabel>传输方式</FormLabel>
                  <Input
                    value={newSystem.transferMethod}
                    onChange={(event) =>
                      setNewSystem({ ...newSystem, transferMethod: event.target.value })
                    }
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>SLA（天）</FormLabel>
                  <Input
                    type="number"
                    value={newSystem.slaDays}
                    onChange={(event) =>
                      setNewSystem({ ...newSystem, slaDays: Number(event.target.value) || 0 })
                    }
                  />
                </FormControl>
              </HStack>
              <FormControl>
                <FormLabel>支持请求类型</FormLabel>
                <HStack wrap="wrap">
                  {ALL_TYPES.map((type) => (
                    <Checkbox
                      key={type}
                      isChecked={newSystem.requestTypes.includes(type)}
                      onChange={(event) =>
                        setNewSystem({
                          ...newSystem,
                          requestTypes: event.target.checked
                            ? [...newSystem.requestTypes, type]
                            : newSystem.requestTypes.filter((entry) => entry !== type),
                        })
                      }
                    >
                      {requestTypeLabels[type]}
                    </Checkbox>
                  ))}
                </HStack>
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr="3" onClick={onClose}>取消</Button>
            <Button
              colorScheme="brand"
              isDisabled={!newSystem.name.trim() || !newSystem.owner.trim()}
              onClick={() => {
                setSystems((current) => [
                  ...current,
                  {
                    id: `sys-${crypto.randomUUID().slice(0, 8)}`,
                    name: newSystem.name.trim(),
                    owner: newSystem.owner.trim(),
                    dataDomain: newSystem.dataDomain.trim() || '待补充',
                    transferMethod: newSystem.transferMethod.trim() || '受控接口导出',
                    slaDays: newSystem.slaDays,
                    requestTypes: newSystem.requestTypes,
                    status: newSystem.status,
                  },
                ])
                setNewSystem({
                  name: '',
                  owner: '',
                  dataDomain: '',
                  transferMethod: '受控接口导出',
                  slaDays: 5,
                  status: 'active',
                  requestTypes: ['access'],
                })
                onClose()
              }}
            >
              加入草稿
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}
