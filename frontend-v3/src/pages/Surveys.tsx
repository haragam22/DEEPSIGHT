import {
    FlaskConical,
    ImageUp,
    MoreHorizontal,
    RefreshCw,
    Trash2,
    Upload,
    Waves,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { StatusBadge } from '@/components/common/StatusBadge'
import { PageContainer } from '@/components/PageContainer'
import { SpecularButton } from '@/components/reactbits/SpecularButton'
import { UploadDialog } from '@/components/surveys/UploadDialog'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { ApiError, createA4SssSurvey, deleteSurvey, processSurvey } from '@/lib/api'
import { num, relativeTime } from '@/lib/format'
import { useSurveyStore } from '@/stores/surveyStore'

export function Surveys() {
  const { surveys, loading, error, refresh } = useSurveyStore()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'xtf' | 'image' | null>(null)
  const [a4Busy, setA4Busy] = useState(false)
  const [del, setDel] = useState<{ id: string; name: string } | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const afterCreate = (id: string) => {
    toast.success('Survey created  parsing and detection are running.')
    void refresh()
    navigate(`/console/${id}`)
  }

  const runA4Sss = async () => {
    setA4Busy(true)
    try {
      const r = await createA4SssSurvey()
      toast.success('A4 & SSS survey created.')
      await refresh()
      // A4 & SSS is ready immediately; kick detection so it has targets
      await processSurvey(r.survey_id).catch(() => undefined)
      navigate(`/console/${r.survey_id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not create the A4 & SSS survey.')
    } finally {
      setA4Busy(false)
    }
  }

  const reprocess = async (id: string) => {
    try {
      await processSurvey(id)
      toast.success('Detection re-queued.')
      void refresh()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not start detection.')
    }
  }

  const confirmDelete = async () => {
    if (!del) return
    setDelBusy(true)
    try {
      await deleteSurvey(del.id)
      toast.success('Survey deleted.')
      setDel(null)
      await refresh()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete that survey.')
    } finally {
      setDelBusy(false)
    }
  }

  return (
    <PageContainer
      kicker="Library"
      title="Surveys"
      meta={`${num(surveys.length)} file${surveys.length === 1 ? '' : 's'}`}
      description="Every uploaded XTF file and everything derived from it. Upload starts parsing and detection automatically."
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          <Button size="sm" variant="outline" onClick={runA4Sss} disabled={a4Busy}>
            <FlaskConical className="size-4" /> A4 & SSS
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('image')}>
            <ImageUp className="size-4" /> Images
          </Button>
          <SpecularButton size="sm" onClick={() => setDialog('xtf')}>
            <Upload className="size-4" /> Upload XTF
          </SpecularButton>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Panel title="Ingested files" right={<span className="label-micro">click a row to open</span>} flush>
        {loading && !surveys.length ? (
          <div className="space-y-px p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : surveys.length === 0 ? (
          <EmptyState
            className="rounded-none border-0"
            icon={<Waves className="size-8" />}
            title="No surveys yet"
            description="Upload an XTF file, add side-scan images, or spin up the A4 & SSS survey."
            action={
              <Button size="sm" onClick={() => setDialog('xtf')}>
                <Upload className="size-4" /> Upload XTF
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Pings</TableHead>
                <TableHead className="text-right">Targets</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {surveys.map((s) => (
                <TableRow
                  key={s.survey_id}
                  className="cursor-pointer border-l-2 border-transparent transition-colors hover:border-accent hover:bg-accent/5"
                  onClick={() => navigate(`/console/${s.survey_id}`)}
                >
                  <TableCell className="max-w-[360px] truncate font-medium">{s.filename}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {num(s.ping_count)}
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {num(s.detection_count)}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {relativeTime(s.created_at)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/console/${s.survey_id}`)}>
                          Open console
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/reports?survey=${s.survey_id}`)}>
                          View report
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!['ready', 'complete'].includes(s.status)}
                          onClick={() => reprocess(s.survey_id)}
                        >
                          Re-run detection
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDel({ id: s.survey_id, name: s.filename })}
                        >
                          <Trash2 className="size-4" /> Delete survey
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <UploadDialog
        mode="xtf"
        open={dialog === 'xtf'}
        onOpenChange={(v) => setDialog(v ? 'xtf' : null)}
        onDone={afterCreate}
      />
      <UploadDialog
        mode="image"
        open={dialog === 'image'}
        onOpenChange={(v) => setDialog(v ? 'image' : null)}
        onDone={afterCreate}
      />

      <ConfirmDialog
        open={!!del}
        onOpenChange={(v) => !v && setDel(null)}
        title="Delete this survey?"
        description={
          <>
            <span className="font-medium text-foreground">{del?.name}</span> and every detection,
            image and report derived from it will be removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        busy={delBusy}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  )
}
