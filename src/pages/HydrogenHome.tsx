import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { ArrowRight, User, FolderOpen, Beaker, Loader2 } from 'lucide-react';
import { SaveStatusBadge } from '@/components/SaveStatusBadge';

const HydrogenHome = () => {
  const navigate = useNavigate();
  const { project, hydrated } = useHydrogenProject();

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="sr-only">Loading your project…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h1 className="text-4xl font-bold text-foreground">Hydrogen Supply Chain Optimization</h1>
              <p className="text-muted-foreground">Configure your optimization model parameters</p>
            </div>
            <div className="flex items-center gap-3">
              <SaveStatusBadge />
              <Button variant="outline" onClick={() => navigate('/dashboard')}>
                <FolderOpen className="h-4 w-4 mr-2" /> Saved Projects
              </Button>
            </div>
          </div>

          {/* Project Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Project Information</CardTitle>
              <CardDescription>Current session details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 p-4 rounded-lg bg-accent">
                  <User className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">User</p>
                    <p className="font-medium">{project.userName || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-lg bg-accent">
                  <FolderOpen className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Project</p>
                    <p className="font-medium">{project.projectName || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-lg bg-accent">
                  <Beaker className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Scenario</p>
                    <p className="font-medium capitalize">{project.mode}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Setup Card */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration Wizard</CardTitle>
              <CardDescription>
                Follow the step-by-step wizard to configure your hydrogen supply chain infrastructure,
                transport, and consumer requirements
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => navigate('/hydrogen/setup?step=1')}
                className="w-full"
                size="lg"
              >
                Start Configuration
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <h3 className="font-semibold">What you'll configure:</h3>
                <ul className="space-y-1 text-sm text-muted-foreground ml-4">
                  <li>• Fixed 24-hour bundled Johor model</li>
                  <li>• Supported POM, WWTP, BSP, BHH and solar assets</li>
                  <li>• Deterministic vehicle and railway templates</li>
                  <li>• C1–C3 hydrogen demand</li>
                  <li>• Real Gurobi status, plots and result tables</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default HydrogenHome;
