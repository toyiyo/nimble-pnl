import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useExpenseInvoiceUpload } from '@/hooks/useExpenseInvoiceUpload';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
import { formatDateInTimezone } from '@/lib/timezone';
import { useToast } from '@/hooks/use-toast';
import type { CreatePendingOutflowInput, PaymentMethod } from '@/types/pending-outflows';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { ImageCapture } from '@/components/ImageCapture';

interface AddExpenseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'other';
const CONFIDENCE_THRESHOLD = 0.7;

export function AddExpenseSheet({ open, onOpenChange }: AddExpenseSheetProps) {
  const { toast } = useToast();
  const { suppliers, createSupplier } = useSuppliers();
  const { createPendingOutflow } = usePendingOutflowMutations();
  const { uploadInvoice, processInvoice, updateInvoiceUpload, isUploading, isProcessing } =
    useExpenseInvoiceUpload();

  const [step, setStep] = useState<'drop' | 'review'>('drop');
  const [isDragging, setIsDragging] = useState(false);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'pdf' | 'image' | null>(null);
  const [invoiceUploadId, setInvoiceUploadId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [pendingVendorName, setPendingVendorName] = useState<string>('');
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, number | null> | null>(null);
  const [hasOcrError, setHasOcrError] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<CreatePendingOutflowInput>({
    vendor_name: '',
    payment_method: DEFAULT_PAYMENT_METHOD,
    amount: 0,
    issue_date: formatDateInTimezone(new Date(), 'UTC', 'yyyy-MM-dd'),
    category_id: null,
    due_date: null,
    notes: null,
    reference_number: null,
  });

  const resetState = useCallback(() => {
    setStep('drop');
    setIsDragging(false);
    setFileType(null);
    setInvoiceUploadId(null);
    setSelectedSupplierId('');
    setPendingVendorName('');
    setFieldConfidence(null);
    setHasOcrError(false);
    setShowCamera(false);
    setFormData({
      vendor_name: '',
      payment_method: DEFAULT_PAYMENT_METHOD,
      amount: 0,
      issue_date: formatDateInTimezone(new Date(), 'UTC', 'yyyy-MM-dd'),
      category_id: null,
      due_date: null,
      notes: null,
      reference_number: null,
    });
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
  }, [filePreviewUrl]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    if (!formData.vendor_name || selectedSupplierId) return;

    const match = suppliers.find(
      (supplier) => supplier.name.toLowerCase() === formData.vendor_name.toLowerCase().trim(),
    );
    if (match) {
      setSelectedSupplierId(match.id);
      setPendingVendorName('');
    } else if (formData.vendor_name) {
      // No match found - show as pending new vendor
      setSelectedSupplierId('new_supplier');
      setPendingVendorName(formData.vendor_name);
    }
  }, [formData.vendor_name, selectedSupplierId, suppliers]);

  const handleSupplierChange = async (value: string, createNew?: boolean) => {
    setSelectedSupplierId(value);

    if (createNew || value.startsWith('new:')) {
      const supplierName = createNew ? value.trim() : value.replace('new:', '');
      try {
        const newSupplier = await createSupplier({ name: supplierName });
        setFormData((prev) => ({ ...prev, vendor_name: newSupplier.name }));
        setSelectedSupplierId(newSupplier.id);
        setPendingVendorName('');
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error creating supplier:', error);
        }
        const errorMessage = error instanceof Error ? error.message : null;
        toast({
          title: 'Error',
          description: errorMessage ? `Failed to create supplier: ${errorMessage}` : 'Failed to create supplier',
          variant: 'destructive',
        });
      }
      return;
    }

    const supplier = suppliers.find((s) => s.id === value);
    if (supplier) {
      setFormData((prev) => ({ ...prev, vendor_name: supplier.name }));
      setPendingVendorName('');
    }
  };

  const isLowConfidence = (key: string) => {
    const value = fieldConfidence?.[key];
    return value !== null && value !== undefined && value < CONFIDENCE_THRESHOLD;
  };

  const handleFileSelected = useCallback(
    async (file: File) => {
      setHasOcrError(false);
      setFieldConfidence(null);

      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }

      const previewUrl = URL.createObjectURL(file);
      setFilePreviewUrl(previewUrl);
      setFileType(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
      setStep('review');

      const upload = await uploadInvoice(file);
      if (!upload) {
        resetState();
        return;
      }

      setInvoiceUploadId(upload.id);
      const result = await processInvoice(upload.id, file);

      if (!result) {
        setHasOcrError(true);
        return;
      }

      setFieldConfidence(result.fieldConfidence ?? null);

      setFormData((prev) => ({
        ...prev,
        vendor_name: result.vendorName ?? prev.vendor_name,
        issue_date: result.invoiceDate ?? prev.issue_date,
        due_date: result.dueDate ?? prev.due_date,
        amount: typeof result.totalAmount === 'number' ? result.totalAmount : prev.amount,
        reference_number: result.invoiceNumber ?? prev.reference_number,
      }));
    },
    [filePreviewUrl, processInvoice, resetState, uploadInvoice],
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
    event.target.value = '';
  };

  const handleSave = async () => {
    if (!formData.vendor_name || formData.amount <= 0) {
      toast({
        title: 'Missing details',
        description: 'Vendor and total amount are required.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const created = await createPendingOutflow.mutateAsync(formData);

      if (invoiceUploadId && created?.id) {
        await updateInvoiceUpload(invoiceUploadId, {
          pending_outflow_id: created.id,
          vendor_name: formData.vendor_name,
          invoice_date: formData.issue_date,
          due_date: formData.due_date,
          total_amount: formData.amount,
          invoice_number: formData.reference_number,
          status: 'saved',
        });
      }

      onOpenChange(false);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error creating expense:', error);
      }
      const errorMessage = error instanceof Error ? error.message : null;
      toast({
        title: 'Error',
        description: errorMessage ? `Failed to create expense: ${errorMessage}` : 'Failed to create expense',
        variant: 'destructive',
      });
    }
  };

  const isBusy = isUploading || isProcessing || createPendingOutflow.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add expense</SheetTitle>
          <SheetDescription>Upload an invoice or enter the details manually.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {step === 'drop' && (
            showCamera ? (
              <Card className="border-2 rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium">Take a photo of the invoice</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowCamera(false)}
                      aria-label="Close camera"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <ImageCapture
                    onImageCaptured={async (blob) => {
                      const file = new File([blob], `expense-${Date.now()}.jpg`, { type: 'image/jpeg' });
                      setShowCamera(false);
                      await handleFileSelected(file);
                    }}
                    onError={(error) => {
                      toast({
                        title: 'Camera Error',
                        description: error,
                        variant: 'destructive',
                      });
                      setShowCamera(false);
                    }}
                    preferredFacingMode="environment"
                    autoStart={true}
                    allowUpload={false}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card
                className={cn(
                  'border-2 border-dashed rounded-2xl transition-colors',
                  isDragging ? 'border-primary/60 bg-primary/5' : 'border-muted-foreground/30',
                )}
              >
                <CardContent
                  className="p-10 text-center space-y-6"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <UploadCloud className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-semibold">Drag invoice here</p>
                    <p className="text-sm text-muted-foreground">PDF or image files supported.</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-3">
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      Choose file
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowCamera(true)}>
                      Take photo
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setStep('review')}
                  >
                    Enter manually
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/jpg"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                </CardContent>
              </Card>
            )
          )}

          {step === 'review' && (
            <div className={cn('grid grid-cols-1 gap-6', filePreviewUrl ? 'lg:grid-cols-5' : 'lg:grid-cols-1')}>
              {filePreviewUrl && (
                <Card className="lg:col-span-2">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                      {fileType === 'pdf' ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                      Invoice preview
                    </div>
                    {fileType === 'pdf' ? (
                      <object
                        data={filePreviewUrl}
                        type="application/pdf"
                        className="w-full h-[420px] rounded-lg border"
                      >
                        <div className="border rounded-lg p-6 text-center">
                          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-sm text-muted-foreground">PDF preview not available</p>
                        </div>
                      </object>
                    ) : (
                      <img
                        src={filePreviewUrl}
                        alt="Invoice preview"
                        className="w-full h-auto rounded-lg border"
                      />
                    )}
                  </CardContent>
                </Card>
              )}

              <div className={cn('space-y-6', filePreviewUrl ? 'lg:col-span-3' : 'lg:col-span-5')}>
                {isProcessing || isUploading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    We're extracting details...
                  </div>
                ) : filePreviewUrl ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Invoice scanned - details can be edited
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    Enter the details below.
                  </div>
                )}

                {hasOcrError && (
                  <div className="flex items-start gap-2 rounded-lg border border-muted-foreground/30 bg-muted/40 p-3 text-sm text-muted-foreground">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    We couldn't extract details - you can enter them manually.
                  </div>
                )}

                <TooltipProvider>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className={cn(isLowConfidence('vendorName') && 'underline decoration-dotted')}>
                          Vendor
                        </span>
                        {isLowConfidence('vendorName') && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="inline-flex" aria-label="Vendor name uncertain - please confirm">
                                <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>We weren't fully sure - please confirm</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <SearchableSupplierSelector
                        value={selectedSupplierId}
                        onValueChange={handleSupplierChange}
                        suppliers={suppliers}
                        placeholder="Select or create vendor..."
                        showNewIndicator
                        pendingNewName={pendingVendorName}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className={cn(isLowConfidence('invoiceDate') && 'underline decoration-dotted')}>
                            Date
                          </span>
                          {isLowConfidence('invoiceDate') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex" aria-label="Date uncertain - please confirm">
                                  <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>We weren't fully sure - please confirm</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Input
                          type="date"
                          aria-label="Invoice date"
                          value={formData.issue_date}
                          onChange={(event) => setFormData((prev) => ({ ...prev, issue_date: event.target.value }))}
                          className={cn(isLowConfidence('invoiceDate') && 'border-dashed')}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className={cn(isLowConfidence('totalAmount') && 'underline decoration-dotted')}>
                              Total
                            </span>
                            {isLowConfidence('totalAmount') && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button type="button" className="inline-flex" aria-label="Amount uncertain - please confirm">
                                    <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>We weren't fully sure - please confirm</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          {formData.amount > 0 && (
                            <span className="text-sm font-medium text-foreground">
                              {formatCurrency(formData.amount)}
                            </span>
                          )}
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          aria-label="Total amount"
                          value={formData.amount || ''}
                          onChange={(event) =>
                            setFormData((prev) => ({
                              ...prev,
                              amount: parseFloat(event.target.value) || 0,
                            }))
                          }
                          className={cn(isLowConfidence('totalAmount') && 'border-dashed')}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category_id">Category</Label>
                      <SearchableAccountSelector
                        value={formData.category_id || undefined}
                        onValueChange={(value) => setFormData((prev) => ({ ...prev, category_id: value || null }))}
                        filterByTypes={['expense', 'asset', 'cogs']}
                        placeholder="Select category (expense, COGS, or asset)..."
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className={cn(isLowConfidence('dueDate') && 'underline decoration-dotted')}>
                            Due date (optional)
                          </span>
                          {isLowConfidence('dueDate') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex" aria-label="Due date uncertain - please confirm">
                                  <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>We weren't fully sure - please confirm</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Input
                          id="due_date"
                          type="date"
                          aria-label="Due date"
                          value={formData.due_date || ''}
                          onChange={(event) =>
                            setFormData((prev) => ({
                              ...prev,
                              due_date: event.target.value || null,
                            }))
                          }
                          className={cn(isLowConfidence('dueDate') && 'border-dashed')}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className={cn(isLowConfidence('invoiceNumber') && 'underline decoration-dotted')}>
                            Invoice # (optional)
                          </span>
                          {isLowConfidence('invoiceNumber') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="inline-flex" aria-label="Invoice number uncertain - please confirm">
                                  <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>We weren't fully sure - please confirm</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Input
                          id="reference_number"
                          aria-label="Invoice number"
                          value={formData.reference_number || ''}
                          onChange={(event) =>
                            setFormData((prev) => ({
                              ...prev,
                              reference_number: event.target.value || null,
                            }))
                          }
                          className={cn(isLowConfidence('invoiceNumber') && 'border-dashed')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="payment_method">Payment method</Label>
                        <Select
                          value={formData.payment_method}
                          onValueChange={(value) =>
                            setFormData((prev) => ({ ...prev, payment_method: value as PaymentMethod }))
                          }
                        >
                          <SelectTrigger id="payment_method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="check">Check</SelectItem>
                            <SelectItem value="ach">ACH</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </TooltipProvider>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleSave} disabled={isBusy}>
                    {createPendingOutflow.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save expense
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
