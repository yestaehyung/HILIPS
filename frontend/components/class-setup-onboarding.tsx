"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Plus, 
  Trash2, 
  ArrowRight,
  Tag,
  Sparkles,
  Upload,
  CheckCircle,
  Target
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export interface ClassDefinition {
  id: string
  name: string
  color: string
  description?: string
  shortcut?: string
}

interface ClassSetupOnboardingProps {
  onComplete: (classes: ClassDefinition[]) => void
  isDarkMode?: boolean
}

// Predefined color palette
const COLOR_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange  
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray
  "#84cc16", // lime
  "#f59e0b", // amber
  "#14b8a6", // teal
  "#6366f1", // indigo
  "#a855f7", // purple
  "#f43f5e", // rose
]

// Common preset class templates
const PRESET_TEMPLATES = [
  {
    name: "Vehicle Detection",
    classes: [
      { name: "car", color: "#3b82f6" },
      { name: "truck", color: "#ef4444" },
      { name: "bus", color: "#22c55e" },
      { name: "motorcycle", color: "#f97316" },
      { name: "bicycle", color: "#8b5cf6" },
    ]
  },
  {
    name: "Person & Objects",
    classes: [
      { name: "person", color: "#ef4444" },
      { name: "bag", color: "#3b82f6" },
      { name: "phone", color: "#22c55e" },
      { name: "laptop", color: "#f97316" },
    ]
  },
  {
    name: "Indoor Objects",
    classes: [
      { name: "chair", color: "#3b82f6" },
      { name: "table", color: "#22c55e" },
      { name: "monitor", color: "#8b5cf6" },
      { name: "keyboard", color: "#f97316" },
      { name: "mouse", color: "#ef4444" },
    ]
  },
  {
    name: "Food Items",
    classes: [
      { name: "apple", color: "#ef4444" },
      { name: "banana", color: "#eab308" },
      { name: "orange", color: "#f97316" },
      { name: "bottle", color: "#3b82f6" },
      { name: "cup", color: "#8b5cf6" },
    ]
  },
]

export default function ClassSetupOnboarding({
  onComplete,
  isDarkMode = false,
}: ClassSetupOnboardingProps) {
  const [classes, setClasses] = useState<ClassDefinition[]>([])
  const [newClassName, setNewClassName] = useState("")
  const [newClassColor, setNewClassColor] = useState(COLOR_PALETTE[0])
  const { toast } = useToast()

  const getNextAvailableColor = () => {
    const usedColors = classes.map(cls => cls.color)
    return COLOR_PALETTE.find(color => !usedColors.includes(color)) || COLOR_PALETTE[0]
  }

  const handleAddClass = () => {
    if (!newClassName.trim()) {
      toast({
        title: "Class name required",
        description: "Please enter a name for the new class.",
        variant: "destructive"
      })
      return
    }

    if (classes.find(cls => cls.name.toLowerCase() === newClassName.toLowerCase())) {
      toast({
        title: "Class already exists",
        description: "A class with this name already exists.",
        variant: "destructive"
      })
      return
    }

    const newClass: ClassDefinition = {
      id: newClassName.toLowerCase().replace(/\s+/g, '-'),
      name: newClassName,
      color: newClassColor,
    }

    setClasses([...classes, newClass])
    setNewClassName("")
    setNewClassColor(getNextAvailableColor())

    toast({
      title: "Class added",
      description: `"${newClassName}" has been added.`,
    })
  }

  const handleDeleteClass = (classId: string) => {
    setClasses(classes.filter(cls => cls.id !== classId))
  }

  const handleApplyTemplate = (template: typeof PRESET_TEMPLATES[0]) => {
    const newClasses: ClassDefinition[] = template.classes.map(cls => ({
      id: cls.name.toLowerCase().replace(/\s+/g, '-'),
      name: cls.name,
      color: cls.color,
    }))
    setClasses(newClasses)
    toast({
      title: "Template applied",
      description: `Applied "${template.name}" with ${template.classes.length} classes.`,
    })
  }

  const handleComplete = () => {
    if (classes.length === 0) {
      toast({
        title: "No classes defined",
        description: "Please add at least one class before continuing.",
        variant: "destructive"
      })
      return
    }

    // Save to localStorage
    localStorage.setItem("hilips_classes", JSON.stringify(classes))
    onComplete(classes)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const data = JSON.parse(content)
        
        // Support both array format and object with classes array
        const classArray = Array.isArray(data) ? data : data.classes || []
        
        if (!Array.isArray(classArray) || classArray.length === 0) {
          throw new Error("Invalid format")
        }

        const importedClasses: ClassDefinition[] = classArray.map((cls: any, index: number) => ({
          id: (cls.id || cls.name || `class-${index}`).toLowerCase().replace(/\s+/g, '-'),
          name: cls.name || `Class ${index + 1}`,
          color: cls.color || COLOR_PALETTE[index % COLOR_PALETTE.length],
          description: cls.description,
        }))

        setClasses(importedClasses)
        toast({
          title: "Classes imported",
          description: `Imported ${importedClasses.length} classes from file.`,
        })
      } catch (error) {
        toast({
          title: "Import failed",
          description: "Invalid JSON format. Expected an array of class definitions.",
          variant: "destructive"
        })
      }
    }
    reader.readAsText(file)
    event.target.value = "" // Reset input
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newClassName.trim()) {
      e.preventDefault()
      handleAddClass()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-full mb-4">
            <Target className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome to HILIPS</h1>
          <p className="text-muted-foreground text-lg">
            Let's set up your project classes before you start labeling.
          </p>
        </div>

        {/* Main Card */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              Define Your Classes
            </CardTitle>
            <CardDescription>
              Classes are the categories you'll use to label objects in your images.
              Add them manually or use a template to get started quickly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quick Templates */}
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                Quick Start Templates
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_TEMPLATES.map((template) => (
                  <Button
                    key={template.name}
                    variant="outline"
                    className="h-auto py-3 px-4 justify-start"
                    onClick={() => handleApplyTemplate(template)}
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">{template.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {template.classes.length} classes
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or add manually</span>
              </div>
            </div>

            {/* Add Class Form */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Enter class name (e.g., 'car', 'person')"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <Select value={newClassColor} onValueChange={setNewClassColor}>
                <SelectTrigger className="w-20">
                  <div 
                    className="w-4 h-4 rounded border"
                    style={{ backgroundColor: newClassColor }}
                  />
                </SelectTrigger>
                <SelectContent>
                  {COLOR_PALETTE.map((color) => (
                    <SelectItem key={color} value={color}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded border"
                          style={{ backgroundColor: color }}
                        />
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAddClass} disabled={!newClassName.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Class List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Your Classes ({classes.length})
                </Label>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button variant="ghost" size="sm" asChild>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Import JSON
                    </span>
                  </Button>
                </label>
              </div>
              
              {classes.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                  <Tag className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No classes added yet</p>
                  <p className="text-xs text-muted-foreground">
                    Use a template above or add classes manually
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
                  {classes.map((cls) => (
                    <div
                      key={cls.id}
                      className="flex items-center justify-between p-2 border rounded-lg bg-card hover:bg-accent/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: cls.color }}
                        />
                        <span className="font-medium text-sm">{cls.name}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDeleteClass(cls.id)}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Continue Button */}
            <div className="pt-4 border-t">
              <Button
                className="w-full h-12 text-lg"
                onClick={handleComplete}
                disabled={classes.length === 0}
              >
                {classes.length === 0 ? (
                  "Add at least one class to continue"
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-5 w-5" />
                    Start Labeling with {classes.length} Classes
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-2">
                You can always add more classes later while labeling.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
