import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

export interface SuccessInfo { title: string; sub: string; unregistered: boolean }

export function SuccessCard({ info, onNext, onDone }: { info: SuccessInfo; onNext: () => void; onDone: () => void }) {
  return (
    <Card size="sm" role="status">
      <CardHeader>
        <CardTitle>{info.title}</CardTitle>
        <CardDescription>{info.sub}</CardDescription>
      </CardHeader>
      <CardFooter className="flex-col gap-2">
        <Button className="w-full" onClick={onNext}>Scan next asset</Button>
        <Button className="w-full" variant="outline" onClick={onDone}>Done</Button>
      </CardFooter>
    </Card>
  )
}
