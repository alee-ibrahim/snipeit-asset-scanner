import { CircleCheckIcon, PackageIcon, ScanLineIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'

export interface SuccessInfo { title: string; sub: string; unregistered: boolean }

export function SuccessCard({ info, onNext, onDone }: { info: SuccessInfo; onNext: () => void; onDone: () => void }) {
  return (
    <Card size="sm" role="status">
      <CardContent>
        <Empty className="border-0 p-2">
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              className={cn('size-14 rounded-full [&_svg]:size-7', info.unregistered ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')}
            >
              {info.unregistered ? <PackageIcon /> : <CircleCheckIcon />}
            </EmptyMedia>
            <EmptyTitle className="text-lg font-bold">{info.title}</EmptyTitle>
            <EmptyDescription>{info.sub}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
      <CardFooter className="flex-col gap-2 border-t-0 bg-transparent">
        <Button size="touch-lg" onClick={onNext} className="w-full bg-success text-success-foreground hover:bg-success/90">
          <ScanLineIcon /> Scan next asset
        </Button>
        <Button size="touch" variant="ghost" onClick={onDone} className="w-full">Done</Button>
      </CardFooter>
    </Card>
  )
}
