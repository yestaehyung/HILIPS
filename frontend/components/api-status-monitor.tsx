"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, XCircle, Clock, RefreshCw, Server, Wifi, WifiOff, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { API_CONFIG, GEMINI_SEGMENTATION_DEFAULTS } from "@/lib/api-config"

interface ApiEndpoint {
  name: string
  url: string
  method: "GET" | "POST"
  description: string
}

interface ConnectionStatus {
  endpoint: string
  status: "connected" | "disconnected" | "testing" | "error"
  responseTime?: number
  error?: string
  lastChecked?: Date
}

const API_ENDPOINTS: ApiEndpoint[] = [
  {
    name: "Images List",
    url: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.IMAGES}`,
    method: "GET",
    description: "Fetch available images",
  },
  {
    name: "Image Upload",
    url: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPLOAD_IMAGE}`,
    method: "POST",
    description: "Upload new images",
  },
  {
    name: "Generate Polygons",
    url: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.GENERATE_POLYGONS}/test.jpg`,
    method: "GET",
    description: "SAM2 polygon generation",
  },
  {
    name: "Gemini Segmentation",
    url: `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.GEMINI_SEGMENTATION}`,
    method: "POST",
    description: "Gemini-based polygon segmentation",
  },
]

export default function ApiStatusMonitor() {
  const [connectionStatuses, setConnectionStatuses] = useState<ConnectionStatus[]>([])
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [overallHealth, setOverallHealth] = useState<"healthy" | "degraded" | "down">("healthy")
  const { toast } = useToast()

  const testEndpoint = async (endpoint: ApiEndpoint): Promise<ConnectionStatus> => {
    const startTime = Date.now()

    try {
      let response: Response

      if (endpoint.method === "GET") {
        response = await fetch(endpoint.url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        })
      } else {
        // For POST endpoints, send a test payload
        let body: BodyInit | undefined
        let headers: HeadersInit = {}

        if (endpoint.url.includes("upload")) {
          body = new FormData()
        } else if (endpoint.name === "Gemini Segmentation") {
          const { model, temperature, resizeWidth } = GEMINI_SEGMENTATION_DEFAULTS
          body = JSON.stringify({
            filename: "status-check.jpg",
            target: "person",
            model,
            temperature,
            resize_width: resizeWidth,
            image_size: [1024, 768],
          })
          headers = { "Content-Type": "application/json" }
        } else {
          body = JSON.stringify({ test: true })
          headers = { "Content-Type": "application/json" }
        }

        response = await fetch(endpoint.url, {
          method: "POST",
          body,
          headers,
        })
      }

      const responseTime = Date.now() - startTime

      return {
        endpoint: endpoint.name,
        status: response.ok ? "connected" : "error",
        responseTime,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        lastChecked: new Date(),
      }
    } catch (error) {
      return {
        endpoint: endpoint.name,
        status: "disconnected",
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
        lastChecked: new Date(),
      }
    }
  }

  const testAllEndpoints = async () => {
    setIsTestingAll(true)

    // Set all endpoints to testing state
    setConnectionStatuses(
      API_ENDPOINTS.map((endpoint) => ({
        endpoint: endpoint.name,
        status: "testing" as const,
        lastChecked: new Date(),
      })),
    )

    try {
      const results = await Promise.all(API_ENDPOINTS.map((endpoint) => testEndpoint(endpoint)))

      setConnectionStatuses(results)

      // Calculate overall health
      const connectedCount = results.filter((r) => r.status === "connected").length
      const totalCount = results.length

      if (connectedCount === totalCount) {
        setOverallHealth("healthy")
        toast({
          title: "API Status Check Complete",
          description: "All endpoints are responding normally",
        })
      } else if (connectedCount > 0) {
        setOverallHealth("degraded")
        toast({
          variant: "destructive",
          title: "Some API Issues Detected",
          description: `${totalCount - connectedCount} out of ${totalCount} endpoints are not responding`,
        })
      } else {
        setOverallHealth("down")
        toast({
          variant: "destructive",
          title: "API Connection Failed",
          description: "Unable to connect to backend services",
        })
      }
    } catch (error) {
      console.error("Error testing endpoints:", error)
      setOverallHealth("down")
    } finally {
      setIsTestingAll(false)
    }
  }

  const testSingleEndpoint = async (endpoint: ApiEndpoint) => {
    const result = await testEndpoint(endpoint)

    setConnectionStatuses((prev) => prev.map((status) => (status.endpoint === endpoint.name ? result : status)))
  }

  useEffect(() => {
    // Test all endpoints on component mount
    testAllEndpoints()

    // Set up periodic health checks every 30 seconds
    const interval = setInterval(testAllEndpoints, 30000)

    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: ConnectionStatus["status"]) => {
    switch (status) {
      case "connected":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "disconnected":
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />
      case "testing":
        return <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: ConnectionStatus["status"]) => {
    switch (status) {
      case "connected":
        return (
          <Badge variant="default" className="bg-green-500">
            Connected
          </Badge>
        )
      case "disconnected":
        return <Badge variant="destructive">Disconnected</Badge>
      case "error":
        return <Badge variant="destructive">Error</Badge>
      case "testing":
        return <Badge variant="secondary">Testing...</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const getOverallHealthIcon = () => {
    switch (overallHealth) {
      case "healthy":
        return <Wifi className="h-5 w-5 text-green-500" />
      case "degraded":
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case "down":
        return <WifiOff className="h-5 w-5 text-red-500" />
    }
  }

  const connectedCount = connectionStatuses.filter((s) => s.status === "connected").length
  const totalCount = connectionStatuses.length
  const healthPercentage = totalCount > 0 ? (connectedCount / totalCount) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Overall Health Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {getOverallHealthIcon()}
              <div>
                <CardTitle>API Connection Status</CardTitle>
                <CardDescription>Backend service connectivity and health monitoring</CardDescription>
              </div>
            </div>
            <Button onClick={testAllEndpoints} disabled={isTestingAll} variant="outline" size="sm">
              {isTestingAll ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Test All
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Overall Health</span>
            <Badge
              variant={overallHealth === "healthy" ? "default" : "destructive"}
              className={overallHealth === "healthy" ? "bg-green-500" : ""}
            >
              {overallHealth === "healthy" ? "Healthy" : overallHealth === "degraded" ? "Degraded" : "Down"}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Connected Endpoints</span>
              <span>
                {connectedCount}/{totalCount}
              </span>
            </div>
            <Progress value={healthPercentage} className="h-2" />
          </div>

          {overallHealth !== "healthy" && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {overallHealth === "degraded"
                  ? "Some API endpoints are not responding. This may affect certain features."
                  : "Backend services are not available. Please check your connection and try again."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Individual Endpoint Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Server className="mr-2 h-5 w-5" />
            Endpoint Details
          </CardTitle>
          <CardDescription>Individual API endpoint status and response times</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {API_ENDPOINTS.map((endpoint, index) => {
              const status = connectionStatuses.find((s) => s.endpoint === endpoint.name)

              return (
                <div key={endpoint.name} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(status?.status || "testing")}
                    <div>
                      <div className="font-medium">{endpoint.name}</div>
                      <div className="text-sm text-muted-foreground">{endpoint.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {endpoint.method} {endpoint.url}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    {status?.responseTime && (
                      <span className="text-sm text-muted-foreground">{status.responseTime}ms</span>
                    )}
                    {getStatusBadge(status?.status || "testing")}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testSingleEndpoint(endpoint)}
                      disabled={status?.status === "testing"}
                    >
                      <RefreshCw className={`h-3 w-3 ${status?.status === "testing" ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Error Details */}
      {connectionStatuses.some((s) => s.error) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">Connection Errors</CardTitle>
            <CardDescription>Detailed error information for failed connections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {connectionStatuses
                .filter((s) => s.error)
                .map((status) => (
                  <Alert key={status.endpoint} variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{status.endpoint}:</strong> {status.error}
                    </AlertDescription>
                  </Alert>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
