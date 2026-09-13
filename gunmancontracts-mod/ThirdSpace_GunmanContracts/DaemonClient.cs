using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Text;
using MelonLoader;

namespace ThirdSpace_GunmanContracts
{
    /// <summary>
    /// TCP client for the Third Space Vest daemon (newline-delimited JSON, port 5050).
    /// </summary>
    public class DaemonClient : IDisposable
    {
        private TcpClient _client;
        private NetworkStream _stream;
        private string _host;
        private int _port;
        private bool _connected;
        private readonly object _sendLock = new object();
        private DateTime _lastReconnectAttempt = DateTime.MinValue;
        private readonly TimeSpan _reconnectCooldown = TimeSpan.FromSeconds(5);
        private readonly Dictionary<string, DateTime> _lastEventTime = new Dictionary<string, DateTime>();
        private readonly TimeSpan _eventCooldown = TimeSpan.FromMilliseconds(50);

        public bool IsConnected => _connected && _client != null && _client.Connected;

        public DaemonClient()
        {
            _host = "127.0.0.1";
            _port = 5050;
        }

        public void Initialize(string configPath = null)
        {
            if (string.IsNullOrEmpty(configPath) || !File.Exists(configPath))
                return;
            try
            {
                var lines = File.ReadAllLines(configPath);
                foreach (var line in lines)
                {
                    var trimmed = line.Trim();
                    if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith("#"))
                        continue;
                    if (trimmed.Contains(":"))
                    {
                        var parts = trimmed.Split(':');
                        _host = parts[0];
                        if (parts.Length > 1 && int.TryParse(parts[1], out int port))
                            _port = port;
                    }
                    else
                    {
                        _host = trimmed;
                    }
                    MelonLogger.Msg("[ThirdSpace] Using manual config: " + _host + ":" + _port);
                    break;
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("[ThirdSpace] Failed to read config: " + ex.Message);
            }
        }

        public bool Connect()
        {
            if (IsConnected) return true;
            try
            {
                MelonLogger.Msg("[ThirdSpace] Connecting to daemon at " + _host + ":" + _port + "...");
                _client = new TcpClient();
                _client.Connect(_host, _port);
                _stream = _client.GetStream();
                _connected = true;
                MelonLogger.Msg("[ThirdSpace] Connected to daemon!");
                return true;
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("[ThirdSpace] Connection failed: " + ex.Message);
                _connected = false;
                return false;
            }
        }

        public void Disconnect()
        {
            try
            {
                if (_stream != null) _stream.Close();
                if (_client != null) _client.Close();
            }
            catch { }
            finally
            {
                _stream = null;
                _client = null;
                _connected = false;
            }
        }

        public bool TryReconnect()
        {
            if (IsConnected) return true;
            if (DateTime.Now - _lastReconnectAttempt < _reconnectCooldown)
                return false;
            _lastReconnectAttempt = DateTime.Now;
            return Connect();
        }

        /// <summary>
        /// Send a Gunman Contracts game event to the daemon.
        /// </summary>
        public void SendEvent(string eventName, string hand = null, int priority = 0, float? angle = null, string holster = null)
        {
            var eventKey = eventName + "_" + (hand ?? "none") + "_" + (angle.HasValue ? ((int)angle.Value).ToString() : "na") + "_" + (holster ?? "na");
            lock (_lastEventTime)
            {
                DateTime lastTime;
                if (_lastEventTime.TryGetValue(eventKey, out lastTime))
                {
                    if (DateTime.Now - lastTime < _eventCooldown)
                        return;
                }
                _lastEventTime[eventKey] = DateTime.Now;
            }

            var json = "{\"cmd\":\"gunmancontracts_event\",\"event\":\"" + eventName + "\",\"priority\":" + priority;
            if (hand != null)
                json += ",\"hand\":\"" + hand + "\"";
            if (angle.HasValue)
                json += ",\"angle\":" + angle.Value.ToString("0.###", CultureInfo.InvariantCulture);
            if (holster != null)
                json += ",\"holster\":\"" + holster + "\"";
            json += "}";
            SendRaw(json);
        }

        private void SendRaw(string json)
        {
            if (!TryReconnect()) return;
            lock (_sendLock)
            {
                try
                {
                    var message = json + "\n";
                    var bytes = Encoding.UTF8.GetBytes(message);
                    _stream.Write(bytes, 0, bytes.Length);
                }
                catch (Exception ex)
                {
                    MelonLogger.Warning("[ThirdSpace] Send failed: " + ex.Message);
                    _connected = false;
                }
            }
        }

        public void StopAll()
        {
            SendRaw("{\"cmd\":\"stop\"}");
        }

        public void Dispose()
        {
            Disconnect();
        }
    }
}
