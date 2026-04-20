"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Upload, X, FileImage, AlertCircle, CheckCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface FileWithPreview extends File {
  preview?: string
  id: string
  status: "pending" | "uploading" | "success" | "error"
  progress: number
  error?: string
}

interface DragDropUploadProps {
  onUpload: (files: File[]) => Promise<void>
  maxFiles?: number
  maxSize?: number
  accept?: Record<string, string[]>
  disabled?: boolean
}

export default function DragDropUpload({
  onUpload,
  maxFiles = 10,
  maxSize = 10 * 1024 * 1024, // 10MB
  accept = {
    "image/*": [".jpeg", ".jpg", ".png", ".gif", ".webp"],
  },
  disabled = false,
}: DragDropUploadProps) {
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const { toast } = useToast()

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      // Handle rejected files
      if (rejectedFiles.length > 0) {
        rejectedFiles.forEach(({ file, errors }) => {
          errors.forEach((error: any) => {
            toast({
              variant: "destructive",
              title: "File rejected",
              description: `${file.name}: ${error.message}`,
            })
          })
        })
      }

      // Add accepted files
      const newFiles: FileWithPreview[] = acceptedFiles.map((file) =>
        Object.assign(file, {
          id: Math.random().toString(36).substr(2, 9),
          preview: URL.createObjectURL(file),
          status: "pending" as FileWithPreview["status"],
          progress: 0,
        }),
      )

      setFiles((prev) => [...prev, ...newFiles].slice(0, maxFiles))
    },
    [maxFiles, toast],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize,
    maxFiles,
    disabled: disabled || isUploading,
  })

  const removeFile = (fileId: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === fileId)
      if (file?.preview) {
        URL.revokeObjectURL(file.preview)
      }
      return prev.filter((f) => f.id !== fileId)
    })
  }

  const uploadFiles = async () => {
    if (files.length === 0) return

    setIsUploading(true)

    try {
      // Simulate upload progress for each file
      const uploadPromises = files.map(async (file) => {
        setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: "uploading" } : f)))

        // Simulate progress
        for (let progress = 0; progress <= 100; progress += 10) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, progress } : f)))
        }

        try {
          await onUpload([file])
          setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: "success", progress: 100 } : f)))
        } catch (error) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === file.id
                ? {
                    ...f,
                    status: "error",
                    error: error instanceof Error ? error.message : "Upload failed",
                  }
                : f,
            ),
          )
        }
      })

      await Promise.all(uploadPromises)

      const successCount = files.filter((f) => f.status === "success").length
      const errorCount = files.filter((f) => f.status === "error").length

      if (successCount > 0) {
        toast({
          title: "Upload completed",
          description: `Successfully uploaded ${successCount} files${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
        })
      }

      // Clear successful uploads after a delay
      setTimeout(() => {
        setFiles((prev) => prev.filter((f) => f.status !== "success"))
      }, 2000)
    } finally {
      setIsUploading(false)
    }
  }

  const clearAll = () => {
    files.forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview)
      }
    })
    setFiles([])
  }

  const getStatusIcon = (status: FileWithPreview["status"]) => {
    switch (status) {
      case "uploading":
        return <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "error":
        return <AlertCircle className="h-4 w-4 text-destructive" />
      default:
        return <FileImage className="h-4 w-4 text-muted-foreground" />
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <Card>
        <CardContent className="p-6">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
            } ${disabled || isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input {...getInputProps()} />
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <div className="space-y-2">
              <p className="text-lg font-medium">{isDragActive ? "Drop files here" : "Drag & drop images here"}</p>
              <p className="text-sm text-muted-foreground">
                or click to select files (max {maxFiles} files, {Math.round(maxSize / 1024 / 1024)}MB each)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Files ({files.length})</h3>
              <div className="space-x-2">
                <Button
                  size="sm"
                  onClick={uploadFiles}
                  disabled={isUploading || files.every((f) => f.status === "success")}
                >
                  {isUploading ? "Uploading..." : "Upload All"}
                </Button>
                <Button size="sm" variant="outline" onClick={clearAll} disabled={isUploading}>
                  Clear All
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {files.map((file) => (
                <div key={file.id} className="flex items-center space-x-3 p-3 bg-muted/50 rounded-lg">
                  {/* Preview */}
                  {file.preview && (
                    <img
                      src={file.preview || "/placeholder.svg"}
                      alt={file.name}
                      className="w-12 h-12 object-cover rounded border"
                    />
                  )}

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <Badge variant="secondary" className="text-xs">
                        {(file.size / 1024 / 1024).toFixed(1)}MB
                      </Badge>
                    </div>

                    {file.status === "uploading" && <Progress value={file.progress} className="mt-2 h-2" />}

                    {file.status === "error" && file.error && (
                      <p className="text-xs text-destructive mt-1">{file.error}</p>
                    )}
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(file.status)}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(file.id)}
                      disabled={file.status === "uploading"}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
