
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase configuration. Check your .env file.',
  )
}

export const supabase = createClient(
  'https://ojjwmtyphznwrylctygs.supabase.co',
  'sb_publishable_Ntk_XqRzjx4QUVDlxdNS7A_exVBn6mc',
)