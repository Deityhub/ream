export type Category = 'pdf' | 'image'

export type Tool = {
  id: string
  title: string
  description: string
  category: Category
  icon: string
  /** file extensions ('.pdf') or mime patterns ('image/*') the tool takes */
  accept: string[]
  status: 'ready' | 'soon'
}
