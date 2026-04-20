"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Palette, 
  Tag,
  Save,
  Download,
  Upload,
  RotateCcw
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export interface ClassDefinition {
  id: string
  name: string
  color: string
  description?: string
  shortcut?: string
}

interface ClassManagerProps {
  classes: ClassDefinition[]
  onClassesChange: (classes: ClassDefinition[]) => void
  onClassSelect?: (classId: string | null) => void
  selectedClassId?: string | null
  polygonCounts?: Record<string, number>
  onClassDelete?: (classId: string) => void
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

export default function ClassManager({
  classes,
  onClassesChange,
  onClassSelect,
  selectedClassId,
  polygonCounts = {},
  onClassDelete,
}: ClassManagerProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingClass, setEditingClass] = useState<ClassDefinition | null>(null)
  const [newClassName, setNewClassName] = useState("")
  const [newClassColor, setNewClassColor] = useState(COLOR_PALETTE[0])
  const [newClassDescription, setNewClassDescription] = useState("")
  const [showAddDialog, setShowAddDialog] = useState(false)
  const { toast } = useToast()

  const handleAddClass = () => {
    if (!newClassName.trim()) {
      toast({
        title: "Class name required",
        description: "Please enter a name for the new class.",
        variant: "destructive"
      })
      return
    }

    // Check if class name already exists
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
      description: newClassDescription || undefined,
      shortcut: undefined // Auto-assign shortcuts later if needed
    }

    onClassesChange([...classes, newClass])
    
    // Reset form
    setNewClassName("")
    setNewClassColor(COLOR_PALETTE[0])
    setNewClassDescription("")
    setShowAddDialog(false)

    toast({
      title: "Class added",
      description: `${newClassName} has been added to your class list.`,
    })
  }

  const handleDeleteClass = (classId: string) => {
    const classToDelete = classes.find(cls => cls.id === classId)
    if (!classToDelete) return

    const confirmed = window.confirm(`Delete class "${classToDelete.name}"? Polygons using this class will become Unlabeled.`)
    if (!confirmed) return

    const updatedClasses = classes.filter(cls => cls.id !== classId)
    onClassesChange(updatedClasses)
    onClassDelete?.(classId)
    if (selectedClassId === classId) {
      onClassSelect?.(null)
    }

    toast({
      title: "Class deleted",
      description: `${classToDelete.name} has been removed from your class list.`,
    })
  }

  const handleEditClass = (classDefinition: ClassDefinition) => {
    setEditingClass(classDefinition)
    setNewClassName(classDefinition.name)
    setNewClassColor(classDefinition.color)
    setNewClassDescription(classDefinition.description || "")
    setIsEditing(true)
    setShowAddDialog(true)
  }

  const handleUpdateClass = () => {
    if (!editingClass || !newClassName.trim()) return

    const updatedClasses = classes.map(cls => 
      cls.id === editingClass.id 
        ? {
            ...cls,
            name: newClassName,
            color: newClassColor,
            description: newClassDescription || undefined
          }
        : cls
    )

    onClassesChange(updatedClasses)
    
    // Reset form
    setEditingClass(null)
    setIsEditing(false)
    setNewClassName("")
    setNewClassColor(COLOR_PALETTE[0])
    setNewClassDescription("")
    setShowAddDialog(false)

    toast({
      title: "Class updated",
      description: `${newClassName} has been updated.`,
    })
  }

  const handleResetToDefaults = () => {
    onClassesChange([])
    toast({
      title: "Classes reset",
      description: "All classes have been cleared.",
    })
  }

  const getNextAvailableColor = () => {
    const usedColors = classes.map(cls => cls.color)
    return COLOR_PALETTE.find(color => !usedColors.includes(color)) || COLOR_PALETTE[0]
  }

  const handleExportClasses = () => {
    const dataStr = JSON.stringify(classes, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'classes.json'
    link.click()
    URL.revokeObjectURL(url)

    toast({
      title: "Classes exported",
      description: "Your class definitions have been exported.",
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center">
            <Tag className="mr-2 h-5 w-5" />
            Classes ({classes.length})
          </div>
          <div className="flex items-center space-x-2">
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button 
                  size="sm" 
                  onClick={() => {
                    setIsEditing(false)
                    setEditingClass(null)
                    setNewClassColor(getNextAvailableColor())
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {isEditing ? 'Edit Class' : 'Add New Class'}
                  </DialogTitle>
                  <DialogDescription>
                    {isEditing 
                      ? 'Update the class information.' 
                      : 'Create a new class for labeling objects.'
                    }
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="class-name">Class Name</Label>
                    <Input
                      id="class-name"
                      value={newClassName}
                      onChange={(e) => setNewClassName(e.target.value)}
                      placeholder="Enter class name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="class-color">Color</Label>
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-8 h-8 rounded border"
                        style={{ backgroundColor: newClassColor }}
                      />
                      <Select value={newClassColor} onValueChange={setNewClassColor}>
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLOR_PALETTE.map((color) => (
                            <SelectItem key={color} value={color}>
                              <div className="flex items-center space-x-2">
                                <div 
                                  className="w-4 h-4 rounded border"
                                  style={{ backgroundColor: color }}
                                />
                                <span>{color}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="class-description">Description (Optional)</Label>
                    <Input
                      id="class-description"
                      value={newClassDescription}
                      onChange={(e) => setNewClassDescription(e.target.value)}
                      placeholder="Enter class description"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setShowAddDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={isEditing ? handleUpdateClass : handleAddClass}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {isEditing ? 'Update' : 'Add'} Class
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardTitle>
        <CardDescription>
          Manage classes for object labeling
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Class List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {classes.map((classDefinition) => (
            <div
              key={classDefinition.id}
              className={`flex items-center justify-between p-2 border rounded-lg cursor-pointer transition-colors ${
                selectedClassId === classDefinition.id 
                  ? 'border-primary bg-primary/5' 
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => onClassSelect?.(classDefinition.id)}
            >
              <div className="flex items-center space-x-3">
                <div 
                  className="w-4 h-4 rounded border"
                  style={{ backgroundColor: classDefinition.color }}
                />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-medium">{classDefinition.name}</span>
                    {classDefinition.shortcut && (
                      <Badge variant="secondary" className="text-xs">
                        {classDefinition.shortcut}
                      </Badge>
                    )}
                  </div>
                  {classDefinition.description && (
                    <p className="text-xs text-muted-foreground">
                      {classDefinition.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {polygonCounts[classDefinition.id] && (
                  <Badge variant="outline">
                    {polygonCounts[classDefinition.id]}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditClass(classDefinition)
                  }}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteClass(classDefinition.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {classes.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No classes defined</p>
            <p className="text-xs">Click the + button to add classes</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col space-y-2 pt-2 border-t">
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportClasses}
              className="flex-1"
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToDefaults}
              className="flex-1"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={!selectedClassId}
            onClick={() => {
              if (selectedClassId) {
                handleDeleteClass(selectedClassId)
              }
            }}
            className="w-full"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Selected Class
          </Button>
        </div>

        {/* Quick shortcuts help */}
        <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
          <strong>Shortcuts:</strong> 1-9/0 = assign first 10 classes, Backspace = remove class
        </div>
      </CardContent>
    </Card>
  )
}