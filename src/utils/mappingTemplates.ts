import { ColumnMapping } from '@/components/ColumnMappingDialog';
import { supabase } from '@/integrations/supabase/client';

export interface MappingTemplate {
  id?: string;
  restaurant_id: string;
  template_name: string;
  column_mappings: ColumnMapping[];
  csv_headers: string[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Save a column mapping template for a restaurant
 */
export async function saveMappingTemplate(
  restaurantId: string,
  templateName: string,
  csvHeaders: string[],
  mappings: ColumnMapping[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('csv_mapping_templates')
      .upsert({
        restaurant_id: restaurantId,
        template_name: templateName,
        csv_headers: csvHeaders,
        column_mappings: mappings as any, // Cast to Json type
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'restaurant_id,template_name',
      });

    if (error) {
      console.error('Error saving mapping template:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error saving mapping template:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Load mapping templates for a restaurant
 */
export async function loadMappingTemplates(
  restaurantId: string
): Promise<{ templates: MappingTemplate[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('csv_mapping_templates')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error loading mapping templates:', error);
      return { templates: [], error: error.message };
    }

    // Cast column_mappings from Json to ColumnMapping[]
    const templates: MappingTemplate[] = (data || []).map(template => ({
      ...template,
      column_mappings: template.column_mappings as unknown as ColumnMapping[],
    }));

    return { templates };
  } catch (error) {
    console.error('Error loading mapping templates:', error);
    return { 
      templates: [], 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Find the best matching template for given CSV headers
 * Returns the template with the most matching headers
 */
export function findBestMatchingTemplate(
  csvHeaders: string[],
  templates: MappingTemplate[]
): MappingTemplate | null {
  if (templates.length === 0) {
    return null;
  }

  let bestMatch: { template: MappingTemplate; score: number } | null = null;

  for (const template of templates) {
    // Calculate match score based on how many headers match
    const matchingHeaders = template.csv_headers.filter(h => 
      csvHeaders.includes(h)
    ).length;
    
    // Score is the percentage of matching headers
    const score = matchingHeaders / Math.max(csvHeaders.length, template.csv_headers.length);

    // Only consider templates with >50% match as valid
    if (score > 0.5) {
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { template, score };
      }
    }
  }

  return bestMatch?.template || null;
}

/**
 * Apply a saved template to current CSV headers
 * Maps as many columns as possible based on the template
 */
export function applyTemplate(
  template: MappingTemplate,
  csvHeaders: string[]
): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];

  for (const csvHeader of csvHeaders) {
    // Find the mapping from the template
    const templateMapping = template.column_mappings.find(
      m => m.csvColumn === csvHeader
    );

    if (templateMapping) {
      // Use the template mapping
      mappings.push({
        csvColumn: csvHeader,
        targetField: templateMapping.targetField,
        confidence: 'high', // Template-based mappings are high confidence
        isAdjustment: templateMapping.isAdjustment,
        adjustmentType: templateMapping.adjustmentType,
      });
    } else {
      // No mapping in template, leave unmapped
      mappings.push({
        csvColumn: csvHeader,
        targetField: null,
        confidence: 'none',
      });
    }
  }

  return mappings;
}

/**
 * Delete a mapping template
 */
export async function deleteMappingTemplate(
  templateId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('csv_mapping_templates')
      .delete()
      .eq('id', templateId);

    if (error) {
      console.error('Error deleting mapping template:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting mapping template:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
