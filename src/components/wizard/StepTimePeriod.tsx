import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock3 } from 'lucide-react';

export function StepTimePeriod() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Optimization Horizon</h2>
        <p className="text-muted-foreground mt-1">Fixed by the preserved Johor model</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />24 hourly steps</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Every run covers model hours 1 through 24. Calendar dates, alternative durations, and
          seasonal biomass profiles are not supported in this version and cannot be submitted.
        </CardContent>
      </Card>
      <Alert>
        <AlertDescription>
          The supplied solar and electricity profiles are the immutable 24-hour Johor baseline.
        </AlertDescription>
      </Alert>
    </div>
  );
}
