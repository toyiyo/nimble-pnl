import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { query, numResults = 5 } = await req.json()

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('🔍 Performing web search for:', query)

    try {
      // Use DuckDuckGo's HTML search (no API key required)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' product information ingredients nutrition')}`
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })

      if (!response.ok) {
        throw new Error(`Search request failed: ${response.statusText}`)
      }

      const html = await response.text()
      
      // More robust HTML parsing to extract search results
      const results = []
      
      // Try multiple patterns to match DuckDuckGo's HTML structure
      const patterns = [
        // Current DuckDuckGo pattern
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)/g,
        // Alternative pattern
        /<a[^>]*href="([^"]*)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?<span[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)/g,
        // Simplified pattern
        /<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<span[^>]*>([^<]{20,})/g
      ]
      
      for (const pattern of patterns) {
        let match
        let count = 0
        pattern.lastIndex = 0 // Reset regex
        
        while ((match = pattern.exec(html)) !== null && count < numResults) {
          const url = match[1]
          const title = match[2].trim()
          const snippet = match[3].trim()
          
          // Filter out DuckDuckGo internal links and ensure we have real content
          if (url && !url.includes('duckduckgo.com') && title.length > 0 && snippet.length > 10) {
            results.push({
              title,
              snippet,
              url
            })
            count++
          }
        }
        
        // If we got results with this pattern, use them
        if (results.length > 0) {
          break
        }
      }

      // If we got results, return them
      if (results.length > 0) {
        console.log(`✅ Found ${results.length} search results`)
        return new Response(
          JSON.stringify({ 
            results,
            query,
            total: results.length
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      throw new Error('No search results found')
      
    } catch (error) {
      console.error('Real search failed, falling back:', error)
      
      // Fallback to basic structured results based on query
      const fallbackResults = [
        {
          title: `${query} - Product Information`,
          snippet: `Product details and specifications for ${query}. Find comprehensive information about ingredients, nutrition facts, and manufacturer details.`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query + ' product information')}`
        },
        {
          title: `${query} - Nutritional Information`,
          snippet: `Complete nutritional breakdown for ${query}. Includes calorie count, ingredients list, allergen warnings, and dietary information.`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query + ' nutrition facts')}`
        }
      ]

      return new Response(
        JSON.stringify({ 
          results: fallbackResults,
          query,
          total: fallbackResults.length
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Web search error:', error)
    return new Response(
      JSON.stringify({ error: 'Search failed', details: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})