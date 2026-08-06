import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useHydrogenProject, ACTIVE_PROJECT_KEY } from '@/context/HydrogenProjectContext';
import { toast } from 'sonner';
import { Plus, FolderOpen, Trash2, LogOut } from 'lucide-react';
import { isLocalMode } from '@/lib/localMode';
import { createLocalProject, deleteLocalProject, listLocalProjects } from '@/lib/localProjects';

const LOCAL_MODE = isLocalMode();

interface ProjectRow {
  id: string;
  name: string;
  config: unknown;
  created_at: string;
  updated_at: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { updateProject, loadProject, activeProjectId, clearActiveProject } = useHydrogenProject();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [userName, setUserName] = useState('');

  useEffect(() => {
    loadProfile();
    loadProjects();
  }, []);

  const loadProfile = async () => {
    if (LOCAL_MODE) {
      setUserName('Local user');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('profiles').select('name').eq('id', user.id).single();
      if (data) setUserName(data.name);
    }
  };

  const loadProjects = async () => {
    if (LOCAL_MODE) {
      setProjects(listLocalProjects());
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error('Failed to load projects');
    } else {
      setProjects(data || []);
    }
    setLoading(false);
  };

  const createProject = async () => {
    if (!newName.trim()) {
      toast.error('Please enter a project name');
      return;
    }
    if (LOCAL_MODE) {
      const data = createLocalProject(newName.trim());
      toast.success('Project created');
      await openProject(data);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('projects')
      .insert({ name: newName.trim(), user_id: user.id, config: {} })
      .select()
      .single();

    if (error) {
      toast.error('Failed to create project');
    } else if (data) {
      toast.success('Project created');
      await openProject(data as ProjectRow);
    }
  };

  const openProject = async (proj: ProjectRow) => {
    const loaded = await loadProject(proj.id);
    if (!loaded) {
      toast.error('That project is no longer available');
      setProjects((prev) => prev.filter((p) => p.id !== proj.id));
      return;
    }
    if (userName) updateProject({ userName });
    navigate('/hydrogen');
  };

  const deleteProject = async (id: string) => {
    if (LOCAL_MODE) {
      deleteLocalProject(id);
      toast.success('Project deleted');
      setProjects((prev) => prev.filter((project) => project.id !== id));
      if (activeProjectId === id || sessionStorage.getItem(ACTIVE_PROJECT_KEY) === id) {
        clearActiveProject();
      }
      return;
    }
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete project');
    } else {
      toast.success('Project deleted');
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id || sessionStorage.getItem(ACTIVE_PROJECT_KEY) === id) {
        clearActiveProject();
      }
    }
  };

  const handleLogout = async () => {
    if (LOCAL_MODE) {
      clearActiveProject();
      navigate('/hydrogen', { replace: true });
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    clearActiveProject();
    sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">My Projects</h1>
              <p className="text-muted-foreground">Welcome back, {userName || 'User'}</p>
            </div>
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" /> {LOCAL_MODE ? 'Close project' : 'Logout'}
            </Button>
          </div>

          {/* New Project */}
          {showNew ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">New Project</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Project Name</Label>
                  <Input
                    placeholder="Enter project name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createProject()}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={createProject}>Create</Button>
                  <Button variant="outline" onClick={() => { setShowNew(false); setNewName(''); }}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button onClick={() => setShowNew(true)} className="w-full" size="lg">
              <Plus className="h-5 w-5 mr-2" /> New Project
            </Button>
          )}

          {/* Project List */}
          {loading ? (
            <p className="text-center text-muted-foreground">Loading projects...</p>
          ) : projects.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No projects yet. Create your first one above!
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {projects.map((proj) => (
                <Card key={proj.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="py-4 flex items-center justify-between">
                    <button
                      className="flex items-center gap-3 flex-1 text-left"
                      onClick={() => void openProject(proj)}
                    >
                      <FolderOpen className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">{proj.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Updated {new Date(proj.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); deleteProject(proj.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
