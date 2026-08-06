import { useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WizardProgress } from '@/components/wizard/WizardProgress';
import { StepTimePeriod } from '@/components/wizard/StepTimePeriod';
import { StepInfrastructure } from '@/components/wizard/StepInfrastructure';
import { StepTransport } from '@/components/wizard/StepTransport';
import { StepConsumers } from '@/components/wizard/StepConsumers';
import { StepReview } from '@/components/wizard/StepReview';
import { StepResults } from '@/components/wizard/StepResults';
import { ChevronLeft, ChevronRight, Home, Loader2 } from 'lucide-react';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { toast } from 'sonner';
import { SaveStatusBadge } from '@/components/SaveStatusBadge';
import {
  WIZARD_STEP_LABELS,
  TOTAL_STEPS,
  getStepError,
  getCompletedSteps,
} from '@/lib/wizardValidation';

const STEP_COMPONENTS = [
  StepTimePeriod,
  StepInfrastructure,
  StepTransport,
  StepConsumers,
  StepReview,
  StepResults,
];

const clampStep = (value: string | null): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, TOTAL_STEPS);
};

const HydrogenWizard = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { project, hydrated, ensureActiveProject } = useHydrogenProject();

  const currentStep = clampStep(searchParams.get('step'));

  // Normalise an out-of-range or missing step in the URL.
  useEffect(() => {
    if (searchParams.get('step') !== String(currentStep)) {
      const next = new URLSearchParams(searchParams);
      next.set('step', String(currentStep));
      setSearchParams(next, { replace: true });
    }
  }, [currentStep, searchParams, setSearchParams]);

  // Configuration has started — make sure a project exists to save into.
  useEffect(() => {
    if (hydrated) void ensureActiveProject();
  }, [hydrated, ensureActiveProject]);

  const goToStep = useCallback(
    (step: number, replace = false) => {
      const next = new URLSearchParams(searchParams);
      next.set('step', String(step));
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams],
  );

  const validateStep = (step: number): boolean => {
    const error = getStepError(step, project);
    if (error) {
      toast.error(error);
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 1) goToStep(currentStep - 1);
  };

  const handleFinish = () => navigate('/hydrogen');

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="sr-only">Loading your project…</span>
      </div>
    );
  }

  const CurrentStepComponent = STEP_COMPONENTS[currentStep - 1];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Configuration Wizard</h1>
              {project.projectName && (
                <p className="text-muted-foreground mt-1">{project.projectName}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <SaveStatusBadge />
              <Button variant="outline" onClick={() => navigate('/hydrogen')}>
                <Home className="h-4 w-4 mr-1" /> Hydrogen Home
              </Button>
            </div>
          </div>

          {/* Progress */}
          <WizardProgress
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            stepLabels={[...WIZARD_STEP_LABELS]}
            onStepClick={(step) => {
              if (step < currentStep) {
                goToStep(step);
              } else if (step > currentStep) {
                for (let s = currentStep; s < step; s++) {
                  if (!validateStep(s)) return;
                }
                goToStep(step);
              }
            }}
            completedSteps={getCompletedSteps(project)}
          />

          {/* Content */}
          <Card>
            <CardContent className="pt-6">
              <CurrentStepComponent />
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={handleBack} disabled={currentStep === 1}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {currentStep < TOTAL_STEPS ? (
              <Button onClick={handleNext}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleFinish} variant="outline">
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HydrogenWizard;
