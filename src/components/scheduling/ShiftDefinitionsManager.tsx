import { useState, useCallback } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
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

import { Plus, Pencil, Trash2, Clock } from 'lucide-react';

import {
  useShiftDefinitions,
  useDeleteShiftDefinition,
  useUpdateShiftDefinition,
} from '@/hooks/useShiftDefinitions';
import { useEmployeePositions } from '@/hooks/useEmployeePositions';

import { ShiftTemplate } from '@/types/scheduling';

import { ShiftDefinitionDialog } from './ShiftDefinitionDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShiftDefinitionsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftDefinitionsManager({
  open,
  onOpenChange,
  restaurantId,
}: ShiftDefinitionsManagerProps) {
  const { definitions, isLoading } = useShiftDefinitions(restaurantId);
  const { positions } = useEmployeePositions(restaurantId);
  const deleteMutation = useDeleteShiftDefinition();
  const updateMutation = useUpdateShiftDefinition();

  // Dialog state (single dialog pattern)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<ShiftTemplate | null>(null);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<ShiftTemplate | null>(null);

  const handleCreate = useCallback(() => {
    setEditingDef(null);
    setDialogOpen(true);
  }, []);

  const handleEdit = useCallback((def: ShiftTemplate) => {
    setEditingDef(def);
    setDialogOpen(true);
  }, []);

  const handleToggleActive = useCallback(
    (def: ShiftTemplate) => {
      updateMutation.mutate({ id: def.id, is_active: !def.is_active });
    },
    [updateMutation],
  );

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id, restaurantId },
      { onSuccess: () => setDeleteTarget(null) },
    );
  }, [deleteTarget, deleteMutation, restaurantId]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          {/* Header */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <SheetTitle className="text-[17px] font-semibold text-foreground">
                    Shift Definitions
                  </SheetTitle>
                  <SheetDescription className="text-[13px] text-muted-foreground mt-0.5">
                    Reusable shift templates for scheduling
                  </SheetDescription>
                </div>
              </div>
              <Button
                onClick={handleCreate}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add
              </Button>
            </div>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : definitions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                  <Clock className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-[14px] font-medium text-foreground">
                  No shift definitions yet
                </p>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Create your first shift definition to get started.
                </p>
              </div>
            ) : (
              definitions.map((def) => (
                <div
                  key={def.id}
                  className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Color dot */}
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: def.color || '#3b82f6' }}
                    />
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-foreground truncate">
                        {def.name}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        {formatTime(def.start_time)} &ndash; {formatTime(def.end_time)}
                      </p>
                    </div>
                    {/* Position badge */}
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted shrink-0">
                      {def.position || 'Any'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Active toggle */}
                    <Switch
                      checked={def.is_active}
                      onCheckedChange={() => handleToggleActive(def)}
                      aria-label={`Toggle ${def.name} active`}
                      className="data-[state=checked]:bg-foreground"
                    />

                    {/* Edit */}
                    <button
                      onClick={() => handleEdit(def)}
                      aria-label={`Edit ${def.name}`}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-all"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => setDeleteTarget(def)}
                      aria-label={`Delete ${def.name}`}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-destructive hover:text-destructive/80 transition-all"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Create / Edit dialog */}
      <ShiftDefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        definition={editingDef}
        restaurantId={restaurantId}
        positions={positions}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift definition?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.name}&rdquo;. Any
              template slots referencing this definition will also be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
