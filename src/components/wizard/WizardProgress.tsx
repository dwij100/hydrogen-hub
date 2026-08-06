import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  onStepClick?: (step: number) => void;
  completedSteps?: number[];
}

export function WizardProgress({ currentStep, totalSteps: _totalSteps, stepLabels, onStepClick, completedSteps = [] }: WizardProgressProps) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center justify-between">
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const isCompleted = completedSteps.includes(stepNumber);
          const isCurrent = stepNumber === currentStep;
          
          return (
            <li key={label} className="relative flex-1">
              {index !== 0 && (
                <div
                  className={cn(
                    "absolute left-0 top-5 -ml-px h-0.5 w-full -z-10",
                    isCompleted ? "bg-primary" : "bg-border"
                  )}
                  aria-hidden="true"
                />
              )}
              <button 
                className="group relative flex items-center w-full hover:opacity-80 transition-opacity cursor-pointer"
                onClick={() => onStepClick?.(stepNumber)}
                type="button"
              >
                <span className="flex items-center px-2 py-2 text-sm font-medium">
                  <span
                    className={cn(
                      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 bg-background transition-all",
                      isCompleted && "bg-primary border-primary",
                      isCurrent && "border-primary",
                      !isCompleted && !isCurrent && "border-border",
                      "group-hover:scale-105"
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5 text-primary-foreground" />
                    ) : (
                      <span
                        className={cn(
                          "text-sm",
                          isCurrent && "text-primary font-semibold",
                          !isCurrent && "text-muted-foreground"
                        )}
                      >
                        {stepNumber}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "ml-3 text-sm font-medium hidden md:block",
                      isCurrent && "text-primary",
                      !isCurrent && "text-muted-foreground"
                    )}
                  >
                    {label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
