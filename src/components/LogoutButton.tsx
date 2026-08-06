import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useHydrogenProject, ACTIVE_PROJECT_KEY } from '@/context/HydrogenProjectContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const [showDialog, setShowDialog] = useState(false);
  const navigate = useNavigate();
  const { clearActiveProject } = useHydrogenProject();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    clearActiveProject();
    sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
    setShowDialog(false);
    navigate('/', { replace: true });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setShowDialog(true)}
        className="gap-2"
      >
        <LogOut className="h-4 w-4" />
        Logout
      </Button>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to logout?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current project session will end. Any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
