import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ShiftTemplateDialog } from '@/components/ShiftTemplateDialog';
import { useShiftTemplates, useDeleteShiftTemplate } from '@/hooks/useShiftTemplates';
import { ShiftTemplate } from '@/types/scheduling';
import { Plus, Edit, Trash2, Calendar } from 'lucide-react';
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

interface ShiftTemplatesManagerProps {
  restaurantId: string;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ShiftTemplatesManager = ({ restaurantId }: ShiftTemplatesManagerProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ShiftTemplate | undefined>();
  const [templateToDelete, setTemplateToDelete] = useState<ShiftTemplate | null>(null);

  const { templates, loading } = useShiftTemplates(restaurantId);
  const deleteTemplate = useDeleteShiftTemplate();

  const handleEdit = (template: ShiftTemplate) => {
    setSelectedTemplate(template);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setSelectedTemplate(undefined);
    setDialogOpen(true);
  };

  const handleDelete = (template: ShiftTemplate) => {
    setTemplateToDelete(template);
  };

  const confirmDelete = () => {
    if (templateToDelete && restaurantId) {
      deleteTemplate.mutate(
        { id: templateToDelete.id, restaurantId },
        {
          onSuccess: () => {
            setTemplateToDelete(null);
          },
        }
      );
    }
  };

  // Group templates by day of week
  const templatesByDay = templates.reduce((acc, template) => {
    if (!acc[template.day_of_week]) {
      acc[template.day_of_week] = [];
    }
    acc[template.day_of_week].push(template);
    return acc;
  }, {} as Record<number, ShiftTemplate[]>);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Shift Templates</CardTitle>
              <CardDescription>Create reusable shift templates to speed up scheduling</CardDescription>
            </div>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 bg-gradient-to-br from-muted/50 to-transparent rounded-lg">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
            <p className="text-muted-foreground mb-4">
              Create shift templates to quickly schedule recurring shifts.
            </p>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Template
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(templatesByDay)
              .sort(([a], [b]) => parseInt(a) - parseInt(b))
              .map(([day, dayTemplates]) => (
                <div key={day}>
                  <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                    {DAYS_OF_WEEK[parseInt(day)]}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {dayTemplates.map((template) => (
                      <Card key={template.id} className="group hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h4 className="font-semibold text-sm mb-1">{template.name}</h4>
                              <Badge variant="outline" className="text-xs">
                                {template.position}
                              </Badge>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => handleEdit(template)}
                                aria-label="Edit template"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => handleDelete(template)}
                                aria-label="Delete template"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <div className="flex items-center justify-between">
                              <span>Time:</span>
                              <span className="font-medium text-foreground">
                                {template.start_time} - {template.end_time}
                              </span>
                            </div>
                            {template.break_duration > 0 && (
                              <div className="flex items-center justify-between">
                                <span>Break:</span>
                                <span className="font-medium text-foreground">
                                  {template.break_duration} min
                                </span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </CardContent>

      {/* Dialog for creating/editing templates */}
      <ShiftTemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={selectedTemplate}
        restaurantId={restaurantId}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!templateToDelete} onOpenChange={() => setTemplateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};
